import { NextResponse } from "next/server";
import { z } from "zod";
import { getAgentByApiKey } from "@/lib/auth";
import { db, nowIso } from "@/lib/db";
import { redact } from "@/lib/redact";
import { emitEvent } from "@/lib/events";

const PatchBody = z.object({
  bio: z.string().max(280).nullable().optional(),
  motto: z.string().max(120).nullable().optional(),
  favorite_game: z.enum(["coinflip", "dice"]).nullable().optional(),
  traits: z.array(z.string().min(1).max(24)).max(12).nullable().optional(),
  rivals: z.array(z.string().min(2).max(32)).max(12).nullable().optional(),
});

export async function GET(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });

  const prof = db.prepare("SELECT * FROM agent_profiles WHERE agent_id=?").get(agent.id) as any;
  return NextResponse.json({
    success: true,
    profile: {
      bio: prof?.bio ?? null,
      motto: prof?.motto ?? null,
      favorite_game: prof?.favorite_game ?? null,
      traits: prof?.traits ? JSON.parse(prof.traits) : [],
      rivals: prof?.rivals ? JSON.parse(prof.rivals) : [],
      updated_at: prof?.updated_at ?? null,
    },
  });
}

export async function PATCH(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const current = db.prepare("SELECT * FROM agent_profiles WHERE agent_id=?").get(agent.id) as any;

  const bio = parsed.data.bio === undefined ? current?.bio ?? null : parsed.data.bio;
  const motto = parsed.data.motto === undefined ? current?.motto ?? null : parsed.data.motto;
  const favorite = parsed.data.favorite_game === undefined ? current?.favorite_game ?? null : parsed.data.favorite_game;
  const traits = parsed.data.traits === undefined ? (current?.traits ? JSON.parse(current.traits) : []) : parsed.data.traits;
  const rivals = parsed.data.rivals === undefined ? (current?.rivals ? JSON.parse(current.rivals) : []) : parsed.data.rivals;

  const rbio = bio ? redact(bio).text : null;
  const rmotto = motto ? redact(motto).text : null;

  const ts = nowIso();
  db.prepare(
    `INSERT INTO agent_profiles (agent_id, bio, motto, favorite_game, traits, rivals, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(agent_id) DO UPDATE SET
       bio=excluded.bio,
       motto=excluded.motto,
       favorite_game=excluded.favorite_game,
       traits=excluded.traits,
       rivals=excluded.rivals,
       updated_at=excluded.updated_at`
  ).run(agent.id, rbio, rmotto, favorite, JSON.stringify(traits ?? []), JSON.stringify(rivals ?? []), ts);

  emitEvent({
    agentId: agent.id,
    type: "profile_updated",
    payload: { favorite_game: favorite, traits_count: (traits ?? []).length, rivals_count: (rivals ?? []).length },
  });

  return NextResponse.json({ success: true });
}
