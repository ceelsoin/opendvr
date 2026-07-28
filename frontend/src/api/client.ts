import axios from "axios";

export const apiClient = axios.create({
  baseURL: "/api",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

/**
 * Any 401 (missing/expired session - sessions last 1h, see
 * backend/src/auth/token.ts) bounces the whole app to /login, except for
 * the auth endpoints themselves (a failed login attempt is a normal 401,
 * not an expired-session redirect).
 */
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url: string = error?.config?.url ?? "";
    const isAuthEndpoint = url.startsWith("/auth/");
    if (status === 401 && !isAuthEndpoint && !window.location.pathname.endsWith("/login")) {
      window.location.assign(`${import.meta.env.BASE_URL}login`);
    }
    return Promise.reject(error);
  }
);
