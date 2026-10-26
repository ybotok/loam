import { Pool } from "pg";

// The service's own database; nothing else reads it.
export const db = new Pool({ connectionString: process.env.REFUNDS_DATABASE_URL });
