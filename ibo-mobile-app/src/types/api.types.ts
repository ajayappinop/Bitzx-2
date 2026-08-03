/** Generic API response wrapper */
export interface ApiResponse<T = unknown> {
  ok?: boolean;
  data?: T;
  detail?: string | ValidationError[];
  message?: string;
}

/** FastAPI 422 validation error item */
export interface ValidationError {
  loc: (string | number)[];
  msg: string;
  type: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export class ApiError extends Error {
  status: number;
  detail: string | ValidationError[];
  fieldErrors?: Record<string, string>;

  constructor(
    message: string,
    status: number,
    detail: string | ValidationError[] = message,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}
