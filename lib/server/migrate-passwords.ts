import { hashPassword, isHashedPassword } from "./password";
import { getAllUsers } from "./store";
import fs from "node:fs";
import path from "node:path";

export async function migratePasswordsToHash() {
  const users = getAllUsers();
  let changed = false;

  const migratedUsers = await Promise.all(
    users.map(async (user) => {
      if (isHashedPassword(user.password)) {
        return user;
      }
      changed = true;
      const hashedPassword = await hashPassword(user.password);
      return { ...user, password: hashedPassword };
    })
  );

  if (changed) {
    const storeFilePath = path.join(process.cwd(), ".pm-store.json");
    try {
      let existingData: Record<string, unknown> = {};
      if (fs.existsSync(storeFilePath)) {
        const raw = fs.readFileSync(storeFilePath, "utf8");
        existingData = JSON.parse(raw);
      }
      
      existingData.users = migratedUsers;
      
      fs.writeFileSync(
        storeFilePath,
        JSON.stringify(existingData, null, 2),
        "utf8"
      );
      
      console.log(`✓ Migrated ${users.length} user passwords to hashed format`);
      return true;
    } catch (error) {
      console.error("Failed to migrate passwords:", error);
      return false;
    }
  }

  console.log("All passwords are already hashed");
  return true;
}
