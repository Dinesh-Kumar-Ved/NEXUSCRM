declare module "@remix-run/node" {
  export interface ActionFunctionArgs {
    request: Request;
    params: Record<string, string | undefined>;
    context?: unknown;
  }

  export interface LoaderFunctionArgs extends ActionFunctionArgs {}

  export function json<T>(
    data: T,
    init?: number | { status?: number; statusText?: string; headers?: HeadersInit },
  ): Response;
}

declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    readonly window: Window & typeof globalThis;
  }
}
