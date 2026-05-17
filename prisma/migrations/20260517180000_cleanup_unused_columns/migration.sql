-- AlterTable
ALTER TABLE "User" DROP COLUMN IF EXISTS "isAdmin";

-- AlterTable
ALTER TABLE "Build" DROP COLUMN IF EXISTS "isPopular";

-- AlterTable
ALTER TABLE "ComponentCache" DROP COLUMN IF EXISTS "specs";
