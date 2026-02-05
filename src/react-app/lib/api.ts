/**
 * Centralized API utility with proper error handling
 * Prevents routing conflicts and handles auth errors gracefully
 */

export interface ApiError {
  message: string;
  status: number;
  data?: any;
}

export class ApiClient {
  private baseUrl: string = "";

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl;
  }

  /**
   * Make an API request with proper error handling
   */
  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = endpoint.startsWith("/") 
      ? `${this.baseUrl}${endpoint}` 
      : `${this.baseUrl}/${endpoint}`;

    const defaultHeaders: HeadersInit = {
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
      credentials: "include", // Always include cookies for auth
    });

    // Handle redirects (like OAuth callbacks)
    if (response.status === 302 || response.status === 307 || response.status === 301) {
      const location = response.headers.get("Location");
      if (location) {
        if (location.startsWith("/")) {
          // Relative URL - let React Router handle it
          window.location.href = location;
        } else {
          // Absolute URL - full redirect
          window.location.href = location;
        }
        throw new Error("Redirecting...");
      }
    }

    // Handle errors
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: `HTTP ${response.status}: ${response.statusText}`,
      }));

      const error: ApiError = {
        message: errorData.error || errorData.message || "Request failed",
        status: response.status,
        data: errorData,
      };

      // Handle auth errors specifically
      if (response.status === 401) {
        // Clear any stale auth state
        if (typeof window !== "undefined") {
          // Redirect to home if not already there
          if (!window.location.pathname.startsWith("/")) {
            window.location.href = "/";
          }
        }
      }

      throw error;
    }

    // Handle empty responses
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "GET",
    });
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "DELETE",
    });
  }

  /**
   * PATCH request
   */
  async patch<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "PATCH",
      body: data ? JSON.stringify(data) : undefined,
    });
  }
}

// Export singleton instance
export const api = new ApiClient();

// Export convenience functions
export const apiGet = <T>(endpoint: string, options?: RequestInit) =>
  api.get<T>(endpoint, options);

export const apiPost = <T>(endpoint: string, data?: any, options?: RequestInit) =>
  api.post<T>(endpoint, data, options);

export const apiPut = <T>(endpoint: string, data?: any, options?: RequestInit) =>
  api.put<T>(endpoint, data, options);

export const apiDelete = <T>(endpoint: string, options?: RequestInit) =>
  api.delete<T>(endpoint, options);

export const apiPatch = <T>(endpoint: string, data?: any, options?: RequestInit) =>
  api.patch<T>(endpoint, data, options);

