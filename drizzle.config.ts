import type { Config } from 'drizzle-kit';

/**
 * Migration generation — the surviving intent of spec §7.
 *
 * §7 asks for "EF Core migrations locally from the start even though it is only
 * SQLite". EF Core is .NET and cannot reach the SQLite database living inside
 * an Expo app, so that line predates §2.1's decision to reject MAUI. What §7
 * actually wants — versioned, checked-in schema history from the first commit,
 * because schema history will be needed — is exactly what this produces.
 *
 * EF Core is still the right answer for the Milestone 3 ASP.NET backend. It is
 * simply the wrong side of the wire for the client.
 *
 * `driver: 'expo'` makes drizzle-kit emit a migrations bundle that the Expo
 * SQLite runtime can apply on device, rather than journal files it would have
 * to read off a filesystem that does not exist there.
 */
export default {
  schema: './src/storage-local/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  driver: 'expo',
} satisfies Config;
