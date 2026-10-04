import { parse as parseEnv } from "@std/dotenv";
import { parse as parseYaml } from "@std/yaml";
import { exists } from "@std/fs";
import { dirname, join, resolve } from "@std/path";

type Service = {
  name: string;
  repo: string;
  config: string;
};

const SERVICES: Service[] = [
  {
    name: "client",
    repo: "openhotel",
    config: "app/server/config.yml",
  },
  {
    name: "auth",
    repo: "auth",
    config: "app/server/config.yml",
  },
  {
    name: "onet",
    repo: "onet",
    config: "config.yml",
  },
  {
    name: "web",
    repo: "web",
    config: "app/server/config.yml",
  },
  {
    name: "asset-editor",
    repo: "asset-editor",
    config: "app/server/config.yml",
  },
  {
    name: "static",
    repo: "static",
    config: "app/server/config.yml",
  },
];

const ROOT = import.meta.dirname!;

const ok = (message: string) => console.log(`%c✔ ${message}`, "color: green");
const warn = (message: string) =>
  console.log(`%c⚠ ${message}`, "color: yellow");
const fail = (message: string) => {
  console.log(`%c✘ ${message}`, "color: red");
  Deno.exit(1);
};

const run = async (cmd: string, ...args: string[]): Promise<boolean> => {
  try {
    const { success } = await new Deno.Command(cmd, {
      args,
      stdout: "null",
      stderr: "inherit",
    }).output();

    return success;
  } catch {
    return false;
  }
};

const checkRequirements = async () => {
  if (!(await run("git", "--version"))) fail("git not found");
  if (!(await run("docker", "compose", "version"))) {
    warn("docker compose not found, you will need it to run the stack");
  }
};

const loadEnv = async (): Promise<Record<string, string>> => {
  const envPath = join(ROOT, ".env");

  if (!(await exists(envPath))) {
    await Deno.copyFile(join(ROOT, ".env.example"), envPath);
    ok(".env created from .env.example");
  }

  return parseEnv(await Deno.readTextFile(envPath));
};

const cloneRepos = async (reposDir: string) => {
  for (const { repo } of SERVICES) {
    const repoPath = join(reposDir, repo);

    if (await exists(repoPath)) {
      ok(`${repo} already exists`);
      continue;
    }

    console.log(`Cloning ${repo}...`);
    const cloned = await run(
      "git",
      "clone",
      `https://github.com/openhotel/${repo}.git`,
      repoPath,
    );
    if (cloned) ok(`${repo} cloned`);
    else warn(`${repo} could not be cloned!`);
  }
};

const readYaml = async (path: string): Promise<Record<string, unknown>> =>
  parseYaml(await Deno.readTextFile(path)) ?? {};

const flatten = (
  object: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> =>
  Object.entries(object).reduce((flat, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? { ...flat, ...flatten(value, path) }
      : { ...flat, [path]: value };
  }, {});

const checkConfig = async (
  service: Service,
  configPath: string,
  templatePath: string,
) => {
  let config: Record<string, unknown>;
  try {
    config = flatten(await readYaml(configPath));
  } catch {
    warn(`${service.name}: ${configPath} is not valid yaml`);
    return;
  }

  const template = flatten(await readYaml(templatePath));
  for (const [key, value] of Object.entries(template)) {
    if (config[key] !== value) {
      warn(
        `${service.name}: '${key}' should be '${value}' (is '${config[key]}')`,
      );
    }
  }
};

const copyConfigs = async (reposDir: string) => {
  for (const service of SERVICES) {
    const repoPath = join(reposDir, service.repo);
    if (!(await exists(repoPath))) continue;

    const configPath = join(repoPath, service.config);
    const templatePath = join(ROOT, "configs", `${service.name}.yml`);

    if (await exists(configPath)) {
      await checkConfig(service, configPath, templatePath);
      continue;
    }

    await Deno.mkdir(dirname(configPath), { recursive: true });
    await Deno.copyFile(templatePath, configPath);

    ok(`${service.name}: config created`);
  }
};

await checkRequirements();
const env = await loadEnv();
const reposDir = resolve(ROOT, env.REPOS_DIR ?? "..");

await cloneRepos(reposDir);
await copyConfigs(reposDir);

console.log(`
Ready! Next steps:
  1. deno task up auth
  2. Sign up at http://localhost:2024 and create a hotel
  3. Fill the tokens:
     - openhotel/app/server/config.yml → auth.enabled: true, auth.licenseToken
     - onet/config.yml → auth.token
  4. deno task up
`);
