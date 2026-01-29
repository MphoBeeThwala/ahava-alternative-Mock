
CREATE TABLE profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  full_name TEXT,
  role TEXT NOT NULL CHECK(role IN ('PATIENT', 'NURSE', 'DOCTOR')),
  sanc_id TEXT,
  phone_number TEXT,
  address TEXT,
  latitude REAL,
  longitude REAL,
  is_verified INTEGER DEFAULT 0,
  is_online INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_profiles_user_id ON profiles(user_id);
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_location ON profiles(latitude, longitude);
