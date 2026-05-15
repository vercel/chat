import { resumeHook } from "workflow/api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token } = await params;
  const payload = await request.json();
  await resumeHook(token, payload);
  return new Response("ok");
}
