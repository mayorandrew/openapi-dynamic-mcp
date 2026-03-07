declare module 'swagger2openapi' {
  import type { OpenAPIV3 } from 'openapi-types';

  export interface ConvertOptions {
    patch?: boolean;
    warnOnly?: boolean;
  }

  export interface ConvertResult {
    openapi: OpenAPIV3.Document;
  }

  export function convertObj(
    spec: unknown,
    options?: ConvertOptions,
  ): Promise<ConvertResult>;
}
