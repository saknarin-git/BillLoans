import { backendMethodGroups, backendMethodNames } from "./contracts.ts";

type RpcPayload = {
  method?: string;
  args?: unknown[];
  sessionToken?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });

const notImplemented = (method: string) =>
  json(501, {
    status: "Error",
    code: "NOT_IMPLEMENTED",
    message: `Supabase backend scaffold is ready, but method '${method}' is not implemented yet.`,
  });

const handlers: Record<string, (payload: RpcPayload) => Promise<Response>> = {
  async health() {
    return json(200, {
      status: "Success",
      backend: "supabase-edge-function",
      functionName: "app-api",
      availableMethods: backendMethodNames,
    });
  },
  async listMethods() {
    return json(200, {
      status: "Success",
      groups: backendMethodGroups,
    });
  },
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json(405, { status: "Error", message: "Method not allowed" });
  }

  let payload: RpcPayload = {};
  try {
    payload = (await request.json()) as RpcPayload;
  } catch {
    return json(400, { status: "Error", message: "Invalid JSON payload" });
  }

  const method = String(payload.method || "").trim();
  if (!method) {
    return json(400, { status: "Error", message: "Missing method name" });
  }

  if (handlers[method]) {
    return handlers[method](payload);
  }

  if (backendMethodNames.includes(method)) {
    return notImplemented(method);
  }

  return json(404, {
    status: "Error",
    code: "UNKNOWN_METHOD",
    message: `Unknown backend method '${method}'.`,
  });
});
