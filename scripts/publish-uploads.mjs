// Copy files uploaded in the admin (storage/uploads) into published-uploads/ so the GitHub Pages build
// can serve them at /uploads/…  Then commit and push:  npm.cmd run uploads:publish
// Only public media lives there — private attachments (storage/private) are never copied.
import { cpSync, existsSync } from "node:fs";

if (!existsSync("storage/uploads")) {
  console.log("Nothing to publish (storage/uploads is empty).");
  process.exit(0);
}
cpSync("storage/uploads", "published-uploads", { recursive: true });
console.log("✔ Copied storage/uploads → published-uploads. Commit and push to publish them on the site.");
