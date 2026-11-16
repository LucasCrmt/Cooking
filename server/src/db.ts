// PostgreSQL connection and schema migrations.
//
// Columns are snake_case in the database and camelCase in JS (postgres.camel transform).
// Recipes belong to whoever added them, but every signed-in member of the household sees them
// all (one shared cookbook); favourites, ratings and "cooked it" marks are per person.

import postgres from "postgres";
import { DATABASE_URL } from "./config.ts";

export const sql = postgres(DATABASE_URL, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  // Close idle connections: each one is a Postgres process holding several MB.
  idle_timeout: 60,
  onnotice: () => {},
  transform: postgres.camel,
});

export type Sql = typeof sql;

const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE users (
    id text PRIMARY KEY,
    name text NOT NULL DEFAULT '',
    email text UNIQUE,
    oidc_sub text UNIQUE,
    is_admin boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz
  );

  CREATE TABLE sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method text NOT NULL,
    user_agent text NOT NULL DEFAULT '',
    ip text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE oidc_states (
    state text PRIMARY KEY,
    verifier text NOT NULL,
    nonce text NOT NULL,
    expires_at timestamptz NOT NULL
  );

  CREATE TABLE recipes (
    id bigserial PRIMARY KEY,
    -- Who added it; NULL once that account is deleted (the household keeps the recipe).
    user_id text REFERENCES users(id) ON DELETE SET NULL,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    category text NOT NULL DEFAULT '',
    cuisine text NOT NULL DEFAULT '',
    tags text[] NOT NULL DEFAULT '{}',
    servings integer,
    servings_label text NOT NULL DEFAULT '',
    prep_minutes integer,
    cook_minutes integer,
    total_minutes integer,
    -- One line each; a line starting with "#" is a section heading ("# Pour la pâte").
    ingredients text[] NOT NULL DEFAULT '{}',
    steps text[] NOT NULL DEFAULT '{}',
    notes text NOT NULL DEFAULT '',
    source_url text,
    source_name text NOT NULL DEFAULT '',
    author text NOT NULL DEFAULT '',
    has_image boolean NOT NULL DEFAULT false,
    image_version integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX recipes_created ON recipes(created_at DESC);
  CREATE INDEX recipes_source ON recipes(source_url);

  CREATE TABLE recipe_images (
    recipe_id bigint PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
    mime text NOT NULL,
    data bytea NOT NULL
  );

  CREATE TABLE favorites (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id bigint NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, recipe_id)
  );

  CREATE TABLE ratings (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id bigint NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
    PRIMARY KEY (user_id, recipe_id)
  );

  CREATE TABLE cooked (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id bigint NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    cooked_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX cooked_recipe ON cooked(recipe_id, cooked_at DESC);

  CREATE TABLE kv (key text PRIMARY KEY, value text NOT NULL);
  `,
  /* 2: a recipe can come from several places (the blog, the Instagram video, grandma's notebook):
        a list of {url, name, kind} replaces the single source */ `
  ALTER TABLE recipes ADD COLUMN sources jsonb NOT NULL DEFAULT '[]';
  UPDATE recipes SET sources = jsonb_build_array(jsonb_build_object('url', source_url, 'name', source_name, 'kind', 'web'))
    WHERE source_url IS NOT NULL;
  UPDATE recipes SET sources = jsonb_build_array(jsonb_build_object('url', NULL, 'name', source_name, 'kind', 'other'))
    WHERE source_url IS NULL AND source_name <> '';
  DROP INDEX recipes_source;
  ALTER TABLE recipes DROP COLUMN source_url, DROP COLUMN source_name;
  CREATE INDEX recipes_sources ON recipes USING gin (sources jsonb_path_ops);
  `,
  /* 3: access tokens for the MCP server (Claude reading and adding recipes); only their SHA-256 is kept */ `
  CREATE TABLE api_tokens (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL DEFAULT '',
    hint text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
  );
  CREATE INDEX api_tokens_user ON api_tokens(user_id);
  `,
  /* 4: sharing. A recipe sent to someone in the household (with a note) shows in their "Shared with me";
        a public link (share_token) shows it read-only to anyone who has it, without an account */ `
  CREATE TABLE recipe_shares (
    id bigserial PRIMARY KEY,
    recipe_id bigint NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    from_user text REFERENCES users(id) ON DELETE SET NULL,
    to_user text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    seen_at timestamptz
  );
  CREATE INDEX recipe_shares_to ON recipe_shares(to_user, created_at DESC);
  ALTER TABLE recipes ADD COLUMN share_token text UNIQUE;
  `,
  /* 5: the equipment a recipe needs (keys such as 'oven', 'blender'; see equipment.ts), to filter by */ `
  ALTER TABLE recipes ADD COLUMN equipment text[] NOT NULL DEFAULT '{}';
  CREATE INDEX recipes_equipment ON recipes USING gin (equipment);
  `,
];

export async function migrate() {
  await sql.begin(async (tx) => {
    // Several containers starting at once: only one migrates.
    await tx`SELECT pg_advisory_xact_lock(4242003)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const [{ v }] = await tx<{ v: number }[]>`SELECT coalesce(max(version), 0)::int AS v FROM schema_migrations`;
    for (let i = v; i < MIGRATIONS.length; i++) {
      await tx.unsafe(MIGRATIONS[i]);
      await tx`INSERT INTO schema_migrations (version) VALUES (${i + 1})`;
      console.log(`Database migrated to version ${i + 1}`);
    }
  });
}
