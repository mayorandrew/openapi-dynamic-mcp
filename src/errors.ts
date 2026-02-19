export type ErrorCode =
  | 'CONFIG_ERROR'
  | 'API_NOT_FOUND'
  | 'ENDPOINT_NOT_FOUND'
  | 'AUTH_ERROR'
  | 'REQUEST_ERROR'
  | 'SCHEMA_ERROR';

export class OpenApiMcpError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'OpenApiMcpError';
    this.code = code;
    this.details = details;
  }
}

export function asErrorResponse(error: unknown): {
  code: ErrorCode;
  message: string;
  details?: unknown;
} {
  if (error instanceof OpenApiMcpError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'REQUEST_ERROR',
      message: error.message,
    };
  }

  return {
    code: 'REQUEST_ERROR',
    message: 'Unknown error',
    details: error,
  };
}
