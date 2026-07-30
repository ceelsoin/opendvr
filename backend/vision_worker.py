#!/usr/bin/env python3
"""
Shared, singleton computer-vision inference process, spawned ONCE by
backend/src/media/visionWorker.ts (unlike motion_worker.py, which is one
process PER camera). All cameras' object-detection/face-recognition
requests are funneled through this single process/model instance -
important on weak (dual/quad-core, no GPU) hardware: loading a YOLO/face
model once and serializing inference requests through it costs far less
CPU/RAM than one model instance per camera would.

Deliberately uses ONLY `cv2` (OpenCV's own `dnn`/`objdetect` modules) for
inference, no `onnxruntime`/`torch`/etc: this backend already depends on
`py3-opencv` (Alpine's own prebuilt package, see Dockerfile) for
motion_worker.py's MOG2 background subtraction, and pip's onnxruntime/
opencv-python wheels are glibc-only (won't run on musl/Alpine, same
constraint already documented for py3-opencv). Reusing the one CV
dependency we already have avoids adding a second, heavier ML runtime.

Protocol: newline-delimited JSON on stdin/stdout (Node acts as the RPC
client, see visionWorker.ts). Each request:
    {"id": <int>, "task": "detect"|"face", "image": "<base64 JPEG>"}
Each response:
    {"id": <int>, "result": {...}}   on success
    {"id": <int>, "error": "<message>"}   on failure (never crashes the
                                            worker - a bad frame or a
                                            missing model file just fails
                                            that one request)

Model files are NOT vendored in this repo (they're tens of KB to tens of
MB of binary weights) - see docs/configuration.md for exact download
instructions/URLs. Missing model files are handled gracefully: that
capability responds with an error, everything else keeps working.

Usage: python3 vision_worker.py <yoloModelPath> <yoloInputSize> <faceDetectModelPath> <faceRecognizeModelPath>
"""
import sys
import json
import base64

import numpy as np
import cv2

CONF_THRESHOLD = 0.45
NMS_THRESHOLD = 0.45
FACE_SCORE_THRESHOLD = 0.7
FACE_NMS_THRESHOLD = 0.3

# Standard 80-class COCO label order, matching how YOLOv8/YOLO11 (and most
# COCO-pretrained detectors) index their output - position in this list IS
# the class id.
COCO_CLASSES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat",
    "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
    "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball",
    "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair",
    "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
    "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator",
    "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
]
PERSON_IDS = {0}
VEHICLE_IDS = {1, 2, 3, 4, 5, 6, 7, 8}
ANIMAL_IDS = {14, 15, 16, 17, 18, 19, 20, 21, 22, 23}


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def category_for(class_id: int) -> str:
    if class_id in PERSON_IDS:
        return "person"
    if class_id in VEHICLE_IDS:
        return "vehicle"
    if class_id in ANIMAL_IDS:
        return "animal"
    return "other"


class LazyModel:
    """Loads a cv2 model once, on first use, and remembers permanent load failures (e.g. missing file) so we don't keep retrying a disk read every request."""

    def __init__(self, path: str, loader):
        self.path = path
        self.loader = loader
        self.instance = None
        self.failed = False

    def get(self):
        if self.failed:
            return None
        if self.instance is None:
            try:
                self.instance = self.loader(self.path)
            except Exception as err:  # noqa: BLE001 - any load failure just disables this capability
                log(f"Failed to load model at {self.path}: {err}")
                self.failed = True
                return None
        return self.instance


def decode_image(image_b64: str) -> np.ndarray | None:
    raw = base64.b64decode(image_b64)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def run_detect(yolo: LazyModel, yolo_input_size: int, image_b64: str) -> dict:
    net = yolo.get()
    if net is None:
        return {"error": "model_not_found"}

    img = decode_image(image_b64)
    if img is None:
        return {"error": "invalid_image"}

    height, width = img.shape[:2]
    blob = cv2.dnn.blobFromImage(img, scalefactor=1 / 255.0, size=(yolo_input_size, yolo_input_size), swapRB=True, crop=False)
    net.setInput(blob)
    output = net.forward()

    # YOLOv8/11 ONNX export outputs (1, 4+num_classes, num_anchors) - transpose to (num_anchors, 4+num_classes).
    predictions = np.squeeze(output).T

    scale_x = width / yolo_input_size
    scale_y = height / yolo_input_size

    boxes: list[list[int]] = []
    confidences: list[float] = []
    class_ids: list[int] = []
    for row in predictions:
        class_scores = row[4:]
        class_id = int(np.argmax(class_scores))
        confidence = float(class_scores[class_id])
        if confidence < CONF_THRESHOLD:
            continue
        cx, cy, w, h = row[0], row[1], row[2], row[3]
        x = (cx - w / 2) * scale_x
        y = (cy - h / 2) * scale_y
        boxes.append([int(x), int(y), int(w * scale_x), int(h * scale_y)])
        confidences.append(confidence)
        class_ids.append(class_id)

    objects = []
    if boxes:
        indices = cv2.dnn.NMSBoxes(boxes, confidences, CONF_THRESHOLD, NMS_THRESHOLD)
        for i in np.array(indices).flatten() if len(indices) else []:
            x, y, w, h = boxes[i]
            class_id = class_ids[i]
            label = COCO_CLASSES[class_id] if class_id < len(COCO_CLASSES) else "unknown"
            objects.append({
                "label": label,
                "category": category_for(class_id),
                "confidence": round(confidences[i], 4),
                # Normalized 0..1 box, resolution-independent (matches
                # DetectionZone's own normalized coordinates).
                "box": [
                    round(max(0.0, x / width), 4),
                    round(max(0.0, y / height), 4),
                    round(min(1.0, w / width), 4),
                    round(min(1.0, h / height), 4),
                ],
            })

    return {"objects": objects}


def run_face(face_detector: LazyModel, face_recognizer: LazyModel, image_b64: str) -> dict:
    detector = face_detector.get()
    recognizer = face_recognizer.get()
    if detector is None or recognizer is None:
        return {"error": "model_not_found"}

    img = decode_image(image_b64)
    if img is None:
        return {"error": "invalid_image"}

    height, width = img.shape[:2]
    detector.setInputSize((width, height))
    _, faces = detector.detect(img)

    results = []
    for face in faces if faces is not None else []:
        x, y, w, h = face[0:4]
        aligned = recognizer.alignCrop(img, face)
        embedding = recognizer.feature(aligned)
        results.append({
            "box": [
                round(max(0.0, x / width), 4),
                round(max(0.0, y / height), 4),
                round(min(1.0, w / width), 4),
                round(min(1.0, h / height), 4),
            ],
            "embedding": [round(float(v), 6) for v in embedding.flatten()],
        })

    return {"faces": results}


def run_embed_single_face(face_detector: LazyModel, face_recognizer: LazyModel, image_b64: str) -> dict:
    """Used only for face enrollment (POST /api/faces): returns the embedding of the single largest face found in an uploaded photo."""
    result = run_face(face_detector, face_recognizer, image_b64)
    if "error" in result:
        return result
    faces = result["faces"]
    if not faces:
        return {"error": "no_face_detected"}
    largest = max(faces, key=lambda f: f["box"][2] * f["box"][3])
    return {"embedding": largest["embedding"]}


def main() -> int:
    if len(sys.argv) < 5:
        log("usage: vision_worker.py <yoloModelPath> <yoloInputSize> <faceDetectModelPath> <faceRecognizeModelPath>")
        return 2

    yolo_model_path, yolo_input_size_arg, face_detect_path, face_recognize_path = sys.argv[1:5]
    yolo_input_size = int(yolo_input_size_arg)

    yolo = LazyModel(yolo_model_path, cv2.dnn.readNetFromONNX)
    face_detector = LazyModel(
        face_detect_path,
        lambda path: cv2.FaceDetectorYN.create(path, "", (320, 320), FACE_SCORE_THRESHOLD, FACE_NMS_THRESHOLD, 5000),
    )
    face_recognizer = LazyModel(face_recognize_path, lambda path: cv2.FaceRecognizerSF.create(path, ""))

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue

        request_id = request.get("id")
        task = request.get("task")
        image_b64 = request.get("image")
        try:
            if task == "detect":
                result = run_detect(yolo, yolo_input_size, image_b64)
            elif task == "face":
                result = run_face(face_detector, face_recognizer, image_b64)
            elif task == "embed_face":
                result = run_embed_single_face(face_detector, face_recognizer, image_b64)
            else:
                result = {"error": f"unknown_task:{task}"}
        except Exception as err:  # noqa: BLE001 - never let one bad request kill the shared worker
            log(f"Request {request_id} ({task}) failed: {err}")
            result = {"error": str(err)}

        if "error" in result:
            print(json.dumps({"id": request_id, "error": result["error"]}), flush=True)
        else:
            print(json.dumps({"id": request_id, "result": result}), flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
