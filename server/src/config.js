import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 5000),
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, ''),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  maxGuests: Number(process.env.MAX_GUESTS_PER_EVENT || 1000),
  tzOffset: process.env.APP_TZ_OFFSET || '+03:00',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'event_checkin',
  },
};
