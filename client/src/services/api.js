import axios from "axios";

const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:3001";

let accessToken = null;
let onTokenRefreshed = null;

/**
 * Set the access token for API requests.
 * @param {string|null} token - JWT access token.
 * @returns {void}
 */
export function setAccessToken(token) {
  accessToken = token;
}

/**
 * Get the current access token.
 * @returns {string|null} JWT access token.
 */
export function getAccessToken() {
  return accessToken;
}

/**
 * Register a callback for when the token is refreshed via interceptor.
 * @param {Function} callback - Called with the new token.
 * @returns {void}
 */
export function onInterceptorRefresh(callback) {
  onTokenRefreshed = callback;
}

const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true
});

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

let isRefreshing = false;
let failedQueue = [];

function processQueue(error, token) {
  failedQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else {
      promise.resolve(token);
    }
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response && error.response.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const refreshResponse = await api.post("/api/auth/refresh");
        const newToken = refreshResponse.data.data.accessToken;
        const newUser = refreshResponse.data.data.user;
        setAccessToken(newToken);
        localStorage.setItem("accessToken", newToken);

        if (onTokenRefreshed) {
          onTokenRefreshed(newToken, newUser);
        }

        processQueue(null, newToken);
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem("accessToken");
        setAccessToken(null);
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

export default api;
