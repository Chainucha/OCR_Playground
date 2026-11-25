import { connection } from "next/server";

// GET /api/health -> the app's server is up. Run after a deploy: it answers per request, never from the build.
export async function GET() {
  await connection();
  return Response.json({ app: "ok" });
}
