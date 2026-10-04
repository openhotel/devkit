import { join } from "@std/path";
import {
  fail,
  getReposDir,
  loadEnv,
  ok,
  readYaml,
  ROOT,
  warn,
  writeYaml,
} from "./utils.ts";

type User = { username: string; email: string; password: string };
type Seed = { users: User[]; hotel: { name: string } };
type Session = Record<string, string>;
type Response<Data> = { status: number; data?: Data; message?: string };

const AUTH_API = "http://localhost:2024/api/v3";
const FINGERPRINT = "devkit-seed";
const INTEGRATION = {
  name: "devkit",
  redirectUrl: "http://localhost:1994",
  type: "client",
};
const ONET_TOKEN_LABEL = "onet";

const request = async <Data>(
  method: string,
  pathname: string,
  { body, headers = {} }: { body?: unknown; headers?: Session } = {},
): Promise<Response<Data>> => {
  const response = await fetch(`${AUTH_API}${pathname}`, {
    method,
    headers: { fingerprint: FINGERPRINT, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

  return response.json();
};

const checkAuth = async () => {
  try {
    await request("GET", "/_/version");
  } catch {
    fail(`auth is not running on ${AUTH_API}`);
  }
};

const register = async ({ username, email, password }: User) => {
  const { status, message } = await request("POST", "/account/register", {
    body: {
      username,
      email,
      password,
      rePassword: password,
      languages: ["en"],
    },
  });

  if (status === 200) ok(`${username}: registered`);
  else if (status === 409) ok(`${username}: already registered`);
  else fail(`${username}: register failed (${status} ${message ?? ""})`);
};

const login = async ({ username, email, password }: User): Promise<Session> => {
  const { status, data, message } = await request<{
    accountId: string;
    token: string;
  }>("POST", "/account/login", { body: { email, password } });

  if (status !== 200 || !data) {
    return fail(`${username}: login failed (${status} ${message ?? ""})`);
  }

  return {
    "account-id": data.accountId,
    token: data.token,
  };
};

const setAdmin = async (user: User, session: Session) => {
  const { status } = await request("POST", "/admin", { headers: session });

  if (status === 200) ok(`${user.username}: is now admin`);
  else ok(`auth already has an admin`);
};

const getLicenseToken = async (
  name: string,
  session: Session,
): Promise<string> => {
  type Hotel = {
    hotelId: string;
    name: string;
    integrations: { integrationId: string; name: string }[];
  };

  const getHotel = async () => {
    const { data } = await request<{ hotels: Hotel[] }>(
      "GET",
      "/user/@me/hotel",
      { headers: session },
    );

    return data?.hotels.find((hotel) => hotel.name === name);
  };

  let hotel = await getHotel();
  if (!hotel) {
    const { status } = await request("POST", "/user/@me/hotel", {
      headers: session,
      body: { name, public: false },
    });

    if (status !== 200) fail(`hotel: create failed (${status})`);

    hotel = (await getHotel())!;
    ok(`hotel: '${name}' created`);
  } else {
    ok(`hotel: '${name}' already exists`);
  }

  let integration = hotel.integrations.find(
    ({ name }) => name === INTEGRATION.name,
  );
  if (!integration) {
    const { status, data } = await request<{ integrationId: string }>(
      "POST",
      "/user/@me/hotel/integration",
      { headers: session, body: { hotelId: hotel.hotelId, ...INTEGRATION } },
    );

    if (status !== 200 || !data) fail(`hotel: integration failed (${status})`);

    integration = {
      integrationId: data!.integrationId,
      name: INTEGRATION.name,
    };
  }

  const { data } = await request<{ token: string }>(
    "GET",
    `/user/@me/hotel/integration?hotelId=${hotel.hotelId}&integrationId=${integration.integrationId}`,
    { headers: session },
  );
  if (!data?.token) {
    fail("hotel: license failed");
  }

  ok("hotel: license generated");
  return data!.token;
};

const getOnetToken = async (session: Session): Promise<string> => {
  const { status, data } = await request<{
    tokens: { id: string; label: string }[];
  }>("GET", "/admin/tokens", { headers: session });

  if (status !== 200) {
    fail(`onet: listing tokens failed (${status}), not admin?`);
  }

  for (const { id } of data!.tokens.filter(
    ({ label }) => label === ONET_TOKEN_LABEL,
  )) {
    await request("DELETE", `/admin/tokens?id=${id}`, { headers: session });
  }

  const { data: created } = await request<{ token: string }>(
    "POST",
    "/admin/tokens",
    { headers: session, body: { label: ONET_TOKEN_LABEL } },
  );

  if (!created?.token) fail("onet: token creation failed");

  ok("onet: token generated");
  return created!.token;
};

type Config = { auth?: Record<string, unknown> };

const updateConfig = async (path: string, update: (config: Config) => void) => {
  try {
    const config = await readYaml<Config>(path);
    update(config);
    await writeYaml(path, config);
    ok(`${path} updated`);
  } catch {
    warn(`${path} not found, run 'deno task setup' first`);
  }
};

const seed = await readYaml<Seed>(join(ROOT, "seed.yml"));
const reposDir = getReposDir(await loadEnv());

await checkAuth();

const sessions: Session[] = [];
for (const user of seed.users) {
  await register(user);
  const session = await login(user);
  sessions.push(session);
}

const [owner] = seed.users;
const [ownerSession] = sessions;
await setAdmin(owner, ownerSession);

const licenseToken = await getLicenseToken(seed.hotel.name, ownerSession);
const onetToken = await getOnetToken(ownerSession);

await updateConfig(join(reposDir, "openhotel/app/server/config.yml"), (c) => {
  c.auth = { ...c.auth, enabled: true, licenseToken };
});
await updateConfig(join(reposDir, "onet/config.yml"), (c) => {
  c.auth = { ...c.auth, token: onetToken };
});

console.log(`
Ready! Restart the services to use the new tokens:

Users (password):
${seed.users.map(({ email, password }) => `  - ${email} (${password})`).join("\n")}
`);
