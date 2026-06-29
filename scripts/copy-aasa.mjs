import { copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const source = "public/.well-known/apple-app-site-association";
const destination = "dist/.well-known/apple-app-site-association";

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);

