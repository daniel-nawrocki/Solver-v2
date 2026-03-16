import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabaseConfig.js";

const HAS_PLACEHOLDER_URL = /YOUR-PROJECT-REF/.test(SUPABASE_URL);
const HAS_PLACEHOLDER_KEY = /YOUR-SUPABASE-ANON-KEY/.test(SUPABASE_ANON_KEY);
const IS_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && !HAS_PLACEHOLDER_URL && !HAS_PLACEHOLDER_KEY);

const supabase = IS_CONFIGURED
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;

const QUARRY_GEO_DEFAULTS = [
  { name: "Laurel Hill", state_plane_epsg: 6487, state_plane_unit: "ft" },
  { name: "Texas", state_plane_epsg: 6487, state_plane_unit: "ft" },
  { name: "Barricks", state_plane_epsg: 6487, state_plane_unit: "ft" },
  { name: "Northeast", state_plane_epsg: 6487, state_plane_unit: "ft" },
  { name: "Savage", state_plane_epsg: 6487, state_plane_unit: "ft" },
  { name: "Churchville", state_plane_epsg: 6487, state_plane_unit: "ft" },
  { name: "Medford", state_plane_epsg: 6487, state_plane_unit: "ft" },
  { name: "Beaver Creek", state_plane_epsg: 6487, state_plane_unit: "ft" },
  { name: "Rockville", state_plane_epsg: 6487, state_plane_unit: "ft" },
  { name: "Inwood", state_plane_epsg: 6600, state_plane_unit: "ft" },
  { name: "Quikrete", state_plane_epsg: 6600, state_plane_unit: "ft" },
  { name: "Millville", state_plane_epsg: 6600, state_plane_unit: "ft" },
  { name: "Middletown", state_plane_epsg: 6592, state_plane_unit: "ft" },
];

function normalizeQuarryName(name) {
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function withQuarryDefaults(quarry = {}) {
  const fallback = QUARRY_GEO_DEFAULTS.find((entry) => normalizeQuarryName(entry.name) === normalizeQuarryName(quarry.name)) || null;
  return {
    ...fallback,
    ...quarry,
    state_plane_epsg: Number(quarry.state_plane_epsg ?? fallback?.state_plane_epsg) || null,
    state_plane_unit: String(quarry.state_plane_unit ?? fallback?.state_plane_unit ?? "ft"),
  };
}

export function getDefaultQuarries() {
  return QUARRY_GEO_DEFAULTS.map((entry, index) => withQuarryDefaults({
    id: `default-${index + 1}`,
    name: entry.name,
    default_rock_density: null,
    active: true,
    sort_order: index + 1,
  }));
}

function ensureClient() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

async function currentUserId() {
  const client = ensureClient();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user?.id) throw new Error("No authenticated user.");
  return data.user.id;
}

export function isSupabaseConfigured() {
  return Boolean(supabase);
}

export function supabaseConfigMessage() {
  return isSupabaseConfigured()
    ? ""
    : "Set js/supabaseConfig.js with your Supabase project URL and anon key.";
}

export async function getAuthSession() {
  const client = ensureClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session || null;
}

export function onAuthStateChange(callback) {
  if (!supabase) {
    return { data: { subscription: { unsubscribe() {} } } };
  }
  return supabase.auth.onAuthStateChange((_event, session) => callback(session || null));
}

export async function signInWithPassword(email, password) {
  const client = ensureClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
}

export async function signUpWithPassword(email, password) {
  const client = ensureClient();
  const { error } = await client.auth.signUp({
    email,
    password,
  });
  if (error) throw error;
}

export async function signOutSession() {
  const client = ensureClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function listCloudProjects() {
  const client = ensureClient();
  const { data, error } = await client
    .from("projects")
    .select("id, name, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createCloudProject({ name, document }) {
  const client = ensureClient();
  const userId = await currentUserId();
  const { data, error } = await client
    .from("projects")
    .insert({ user_id: userId, name, document })
    .select("id, name, updated_at")
    .single();
  if (error) throw error;
  return data;
}

export async function updateCloudProject({ id, name, document }) {
  const client = ensureClient();
  const patch = { document };
  if (typeof name === "string" && name.trim()) patch.name = name.trim();
  const { data, error } = await client
    .from("projects")
    .update(patch)
    .eq("id", id)
    .select("id, name, updated_at")
    .single();
  if (error) throw error;
  return data;
}

export async function loadCloudProject(projectId) {
  const client = ensureClient();
  const { data, error } = await client
    .from("projects")
    .select("id, name, document, updated_at")
    .eq("id", projectId)
    .single();
  if (error) throw error;
  return data;
}

export async function renameCloudProject(projectId, name) {
  const client = ensureClient();
  const { data, error } = await client
    .from("projects")
    .update({ name: name.trim() })
    .eq("id", projectId)
    .select("id, name, updated_at")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCloudProject(projectId) {
  const client = ensureClient();
  const { error } = await client.from("projects").delete().eq("id", projectId);
  if (error) throw error;
}

export async function listQuarries() {
  const client = ensureClient();
  const buildQuery = (selectColumns) => client
    .from("quarries")
    .select(selectColumns)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  let { data, error } = await buildQuery("id, name, default_rock_density, active, sort_order, state_plane_epsg, state_plane_unit");
  if (error) {
    ({ data, error } = await buildQuery("id, name, default_rock_density, active, sort_order"));
  }
  if (error) throw error;
  return (data || []).map(withQuarryDefaults);
}
