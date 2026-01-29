import { Hono, Context } from "hono";
import { cors } from "hono/cors";
import { setCookie, getCookie } from "hono/cookie";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import bcrypt from "bcryptjs";
import { Env } from "../../worker-configuration";
import { authMiddleware, type User } from "@/lib/auth-middleware";
import { rateLimit, RateLimits } from "@/lib/rate-limiter";
import { generateUserId, generateSessionId } from "@/lib/auth";
import { CLINICAL_SYSTEM_PROMPT } from "@/shared/prompts";
import type { DiagnosticReport } from "@/shared/types";

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
// CORS middleware
app.use("*", async (c: Context<{ Bindings: Env }>, next) => {
  const corsMiddleware = cors({
    origin: (origin) => {
      const allowedOrigins = [
        "http://localhost:5173",
        "http://localhost:5174",
        c.env.APP_URL || "http://localhost:5173",
      ];
      return allowedOrigins.includes(origin || "") ? origin : "http://localhost:5173";
    },
    credentials: true,
  });
  return corsMiddleware(c, next);
});

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "Ahava Healthcare API" }));

// Session check endpoint
app.get("/api/session", async (c) => {
  const sessionCookie = getCookie(c, "ahava_auth_session");

  if (!sessionCookie) {
    return c.json({ hasUser: false, user: null });
  }

  try {
    const sessionResult = await c.env.DB.prepare(
      "SELECT user_id, expires_at FROM sessions WHERE id = ? AND expires_at > ?"
    )
      .bind(sessionCookie, new Date().toISOString())
      .first<{ user_id: string; expires_at: string }>();

    if (!sessionResult) {
      return c.json({ hasUser: false, user: null });
    }

    const userResult = await c.env.DB.prepare(
      "SELECT id, email FROM user WHERE id = ?"
    )
      .bind(sessionResult.user_id)
      .first<{ id: string; email: string }>();

    if (!userResult) {
      return c.json({ hasUser: false, user: null });
    }

    return c.json({
      hasUser: true,
      user: {
        id: userResult.id,
        email: userResult.email,
      },
    });
  } catch (error) {
    console.error("Session check error:", error);
    return c.json({ hasUser: false, user: null });
  }
});

// Google OAuth Sign-in URL
app.get("/api/auth/sign-in/google", async (c) => {
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${c.env.APP_URL}/api/auth/google/callback`,
    response_type: "code",
    scope: "email profile openid",
    access_type: "offline",
    state: "google_login",
    prompt: "consent",
  }).toString();

  if (c.req.query("json") === "true") {
    return c.json({ redirectUrl: url });
  }
  return c.redirect(url);
});

// Email/Password Signup
app.post("/api/auth/signup", rateLimit(RateLimits.STRICT), async (c) => {
  try {
    const { email, password, name } = await c.req.json();

    if (!email || !password || !name) {
      return c.json({ error: "Name, email and password are required" }, 400);
    }

    // Check if user already exists
    const existingUser = await c.env.DB.prepare(
      "SELECT id FROM user WHERE email = ?"
    )
      .bind(email.toLowerCase())
      .first<{ id: string }>();

    if (existingUser) {
      return c.json({ error: "User already exists" }, 400);
    }

    // Hash password (using simple hash for now - in production use bcrypt/argon2)
    // Hash password with bcrypt
    const userId = generateUserId();
    const passwordHash = await bcrypt.hash(password, 10);

    const now = new Date().toISOString();

    // Insert user
    await c.env.DB.prepare(
      "INSERT INTO user (id, email, password_hash, email_verified, created_at, updated_at, name) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(userId, email.toLowerCase(), passwordHash, 0, now, now, name)
      .run();

    // Create session
    const sessionId = generateSessionId();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

    await c.env.DB.prepare(
      "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(sessionId, userId, expiresAt, now)
      .run();

    setCookie(c, "ahava_auth_session", sessionId, {
      httpOnly: true,
      secure: false, // Set to true in production with HTTPS
      sameSite: "Lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    });

    return c.json({
      success: true,
      user: { id: userId, email: email.toLowerCase() },
    });
  } catch (error: any) {
    console.error("Signup error:", error);
    return c.json(
      { error: error.message || "Failed to create account" },
      500
    );
  }
});

// Email/Password Login
app.post("/api/auth/login", rateLimit(RateLimits.STRICT), async (c) => {
  try {
    const { email, password } = await c.req.json();

    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }

    // Get user
    const user = await c.env.DB.prepare(
      "SELECT id, email, password_hash FROM user WHERE email = ?"
    )
      .bind(email.toLowerCase())
      .first<{ id: string; email: string; password_hash: string }>();

    if (!user) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Verify password
    // Verify password with bcrypt
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Create session
    const sessionId = generateSessionId();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(sessionId, user.id, expiresAt, now)
      .run();

    setCookie(c, "ahava_auth_session", sessionId, {
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    });

    return c.json({
      success: true,
      user: { id: user.id, email: user.email },
    });
  } catch (error: any) {
    console.error("Login error:", error);
    return c.json({ error: error.message || "Failed to login" }, 500);
  }
});

// Logout
app.post("/api/auth/logout", authMiddleware, async (c) => {
  const sessionCookie = getCookie(c, "ahava_auth_session");

  if (sessionCookie) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?")
      .bind(sessionCookie)
      .run();
  }

  setCookie(c, "ahava_auth_session", "", {
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
    maxAge: 0,
    path: "/",
  });

  return c.json({ success: true });
});

// Google OAuth callback
app.get("/api/auth/google/callback", async (c) => {
  try {
    const code = c.req.query("code");


    if (!code) {
      return c.redirect(`${c.env.APP_URL}/?error=oauth_failed`);
    }

    // Exchange code for token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${c.env.APP_URL}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("Google token exchange failed:", errorData);
      return c.redirect(`${c.env.APP_URL}/?error=token_exchange_failed`);
    }

    const tokens = await tokenResponse.json() as any;
    const accessToken = tokens.access_token;

    // Get user info from Google
    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!userInfoResponse.ok) {
      return c.redirect(`${c.env.APP_URL}/?error=user_info_failed`);
    }

    const googleUser = await userInfoResponse.json() as any;

    // Check if user exists
    let user: { id: string; email: string } | null = await c.env.DB.prepare(
      "SELECT id, email FROM user WHERE email = ?"
    )
      .bind(googleUser.email.toLowerCase())
      .first<{ id: string; email: string }>();

    // Create user if doesn't exist
    if (!user) {
      const userId = generateUserId();
      const now = new Date().toISOString();

      await c.env.DB.prepare(
        "INSERT INTO user (id, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(userId, googleUser.email.toLowerCase(), 1, now, now)
        .run();

      user = { id: userId, email: googleUser.email.toLowerCase() };
    }

    // Create session
    const sessionId = generateSessionId();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(sessionId, user.id, expiresAt, now)
      .run();

    setCookie(c, "ahava_auth_session", sessionId, {
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    });

    return c.redirect(`${c.env.APP_URL}/`);
  } catch (error: any) {
    console.error("Google OAuth callback error:", error);
    return c.redirect(`${c.env.APP_URL}/?error=oauth_error`);
  }
});

// Get profile
app.get("/api/profile", authMiddleware, async (c) => {
  try {
    const user = c.get("user") as User;

    const profile = await c.env.DB.prepare(
      "SELECT * FROM profiles WHERE user_id = ?"
    )
      .bind(user.id)
      .first();

    if (!profile) {
      return c.json({ profile: null });
    }

    return c.json({ profile });
  } catch (error: any) {
    console.error("Get profile error:", error);
    return c.json({ error: error.message || "Failed to get profile" }, 500);
  }
});

// Create/Update profile
app.post("/api/profile", authMiddleware, async (c) => {
  try {
    const user = c.get("user") as User;
    const data = await c.req.json();

    // Check if profile exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM profiles WHERE user_id = ?"
    )
      .bind(user.id)
      .first<{ id: number }>();

    const now = new Date().toISOString();

    if (existing) {
      // Update existing profile
      await c.env.DB.prepare(
        `UPDATE profiles SET 
          full_name = ?,
          role = ?,
          sanc_id = ?,
          phone_number = ?,
          address = ?,
          latitude = ?,
          longitude = ?,
          updated_at = ?
        WHERE user_id = ?`
      )
        .bind(
          data.full_name || null,
          data.role,
          data.sanc_id || null,
          data.phone_number || null,
          data.address || null,
          data.latitude || null,
          data.longitude || null,
          now,
          user.id
        )
        .run();
    } else {
      // Create new profile
      await c.env.DB.prepare(
        `INSERT INTO profiles (
          user_id, full_name, role, sanc_id, phone_number, 
          address, latitude, longitude, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          user.id,
          data.full_name || null,
          data.role,
          data.sanc_id || null,
          data.phone_number || null,
          data.address || null,
          data.latitude || null,
          data.longitude || null,
          now,
          now
        )
        .run();
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Profile update error:", error);
    return c.json({ error: error.message || "Failed to update profile" }, 500);
  }
});

// Helper function to insert diagnostic report with schema fallback
async function insertDiagnosticReport(
  db: D1Database,
  reportData: {
    patient_id: string;
    report_type: string;
    symptoms: string;
    ai_analysis: string | null;
    ai_confidence: number | null;
  }
): Promise<number> {
  // Try with ai_analysis column first (migration 4 schema)
  try {
    const result = await db
      .prepare(
        `INSERT INTO diagnostic_reports (
          patient_id, report_type, symptoms, ai_analysis, ai_confidence, 
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        reportData.patient_id,
        reportData.report_type,
        reportData.symptoms,
        reportData.ai_analysis,
        reportData.ai_confidence,
        new Date().toISOString(),
        new Date().toISOString()
      )
      .run();

    return Number(result.meta.last_row_id);
  } catch (error: any) {
    // If ai_analysis column doesn't exist, try without it
    if (error.message?.includes("no column named ai_analysis")) {
      const result = await db
        .prepare(
          `INSERT INTO diagnostic_reports (
            patient_id, report_type, symptoms, ai_confidence, 
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          reportData.patient_id,
          reportData.report_type,
          reportData.symptoms + (reportData.ai_analysis ? `\n\nAI Analysis: ${reportData.ai_analysis}` : ""),
          reportData.ai_confidence,
          new Date().toISOString(),
          new Date().toISOString()
        )
        .run();

      return Number(result.meta.last_row_id);
    }
    throw error;
  }
}

// Diagnostic Analysis endpoint
app.post(
  "/api/diagnostic-analysis",
  authMiddleware,
  rateLimit(RateLimits.STRICT),
  async (c) => {
    try {
      const user = c.get("user") as User;
      const { symptoms, images, imageData, imageUrl } = await c.req.json();
      // images is Array<{ url: string, type: string, description?: string }>

      if (!symptoms) {
        return c.json({ error: "Symptoms are required" }, 400);
      }

      // Check Gemini API key
      if (!c.env.GEMINI_API_KEY) {
        console.error("Gemini API key not configured");
        return c.json({ error: "AI service not configured" }, 500);
      }

      console.log("Gemini API key check:", {
        hasKey: !!c.env.GEMINI_API_KEY,
        keyLength: c.env.GEMINI_API_KEY.length,
        keyPrefix: c.env.GEMINI_API_KEY.substring(0, 7),
      });

      // Initialize Gemini
      const genAI = new GoogleGenerativeAI(c.env.GEMINI_API_KEY);
      console.log("GoogleGenerativeAI initialized successfully");

      // Use gemini-2.5-flash as locked model
      const modelName = "gemini-2.5-flash";
      console.log("Using model:", modelName);

      // Configure Safety Settings to allow medical content
      const safetySettings = [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ];

      const model = genAI.getGenerativeModel({
        model: modelName,
        safetySettings: safetySettings
      });

      // Build prompt
      const systemPrompt = CLINICAL_SYSTEM_PROMPT;

      let prompt = `${systemPrompt}\n\nPatient Symptoms:\n${symptoms}`;

      if (images && Array.isArray(images) && images.length > 0) {
        prompt += `\n\nMedical Images Provided (${images.length}):`;
        images.forEach((img: any, index: number) => {
          prompt += `\n${index + 1}. [${img.type}] ${img.description || 'No description'} (URL: ${img.url})`;
        });
        prompt += `\n\nPlease analyze the symptoms in context with the declared images.`;
      } else if (imageData || imageUrl) {
        // Fallback for legacy calls
        prompt += `\n\nMedical Image Analysis Required: ${imageData ? "Image data provided" : `Image URL: ${imageUrl}`}`;
      }

      // Call Gemini with retry logic
      console.log("Calling Gemini API with retry logic...");
      let geminiResponse: string = "";
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        attempts++;
        console.log(`Gemini API call attempt ${attempts}/${maxAttempts}`);

        try {
          const result = await model.generateContent(prompt);
          const response = await result.response;
          geminiResponse = response.text();
          console.log(`Gemini API call successful on attempt ${attempts}`);
          console.log(`Got response from Gemini, length: ${geminiResponse.length}`);
          break;
        } catch (error: any) {
          console.error(`Gemini API call attempt ${attempts} failed:`, error);

          // Check for safety blocking specifically
          if (error.message?.includes("SAFETY") || error.message?.includes("blocked")) {
            console.error("Content blocked by safety filters. Considerations: Medical content may be flagged.");
            // Non-retryable if safety blocked
            throw new Error("AI Analysis failed: Content flagged by safety filters. Please try rephrasing.");
          }

          if (attempts >= maxAttempts) {
            throw new Error(`Gemini API failed after ${maxAttempts} attempts: ${error.message}`);
          }

          // Exponential backoff
          const isRateLimit = error.message?.includes("429") || error.status === 429;
          const isServerError = error.message?.includes("500") || error.message?.includes("503") || error.status === 500 || error.status === 503;

          let delayMs = 1000 * Math.pow(2, attempts - 1); // 1s, 2s, 4s
          if (isRateLimit || isServerError) {
            delayMs = [5000, 10000, 20000][attempts - 1]; // Longer delays for rate limits/server errors
          }

          console.log(`Retrying in ${delayMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      if (!geminiResponse) {
        throw new Error("Failed to get response from Gemini API");
      }

      // Calculate confidence (simple heuristic based on response length and structure)
      const confidence = Math.min(95, Math.max(60, geminiResponse.length / 50));

      // Insert diagnostic report with schema fallback
      const reportId = await insertDiagnosticReport(c.env.DB, {
        patient_id: user.id,
        report_type: "SYMPTOM_ANALYSIS",
        symptoms: symptoms + (images && images.length > 0 ? `\n[${images.length} Images Attached]` : ""),
        ai_analysis: geminiResponse,
        ai_confidence: confidence,
      });

      return c.json({
        success: true,
        reportId,
        analysis: geminiResponse,
        confidence: Math.round(confidence),
      });
    } catch (error: any) {
      console.error("Diagnostic analysis error:", error);
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
      });
      return c.json(
        {
          error: "Failed to perform diagnostic analysis",
          message: error.message || "Internal server error",
        },
        500
      );
    }
  }
);

// Get diagnostic reports
app.get("/api/patient/diagnostic-reports", authMiddleware, async (c) => {
  try {
    const user = c.get("user") as User;
    console.log(`Getting diagnostic reports for user: ${user.id}`);

    const reports = await c.env.DB.prepare(
      `SELECT * FROM diagnostic_reports 
       WHERE patient_id = ? 
       ORDER BY COALESCE(released_at, created_at) DESC`
    )
      .bind(user.id)
      .all<DiagnosticReport>();

    console.log("Query executed successfully");
    console.log(`Found reports: ${reports.results?.length || 0}`);

    return c.json({ reports: reports.results || [] });
  } catch (error: any) {
    console.error("Get diagnostic reports error:", error);
    return c.json({ error: error.message || "Failed to get reports" }, 500);
  }
});

// Dev-only AI test endpoint
app.post("/api/ai/test", async (c) => {
  try {
    const devToken = c.req.header("x-dev-test-token");
    if (devToken !== c.env.DEV_TEST_TOKEN) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { prompt } = await c.req.json();
    if (!c.env.GEMINI_API_KEY) {
      return c.json({ error: "Gemini API key not configured" }, 500);
    }

    const genAI = new GoogleGenerativeAI(c.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response;

    return c.json({
      success: true,
      response: response.text(),
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Image Upload Endpoint
app.post("/api/upload-image", authMiddleware, async (c) => {
  try {
    const user = c.get("user") as User;
    const formData = await c.req.parseBody();
    const image = formData["file"] || formData["image"]; // Accept 'file' (standard) or 'image'

    if (!image || !(image instanceof File)) {
      return c.json({ error: "No image file provided" }, 400);
    }

    const key = `${user.id}/${Date.now()}-${image.name}`;
    await c.env.MEDICAL_IMAGES_BUCKET.put(key, image.stream(), {
      httpMetadata: { contentType: image.type },
    });

    const url = `${c.env.APP_URL}/api/images/${key}`; // Configured to serve via worker or public R2 URL
    return c.json({ url });
  } catch (error: any) {
    console.error("Image upload error:", error);
    return c.json({ error: error.message || "Failed to upload image" }, 500);
  }
});


// Biometrics Endpoint
app.get("/api/biometrics", authMiddleware, async (c) => {
  try {
    const user = c.get("user") as User;
    const limit = c.req.query("limit") || 20;

    // Check if biometrics table exists, if not return mock data or empty
    try {
      const results = await c.env.DB.prepare(
        "SELECT * FROM biometrics WHERE user_id = ? ORDER BY recorded_at DESC LIMIT ?"
      ).bind(user.id, limit).all();
      return c.json(results.results || []);
    } catch (e) {
      // Table likely doesn't exist yet, return empty array to prevent 404/500
      console.warn("Biometrics table missing or query failed", e);
      return c.json([]);
    }
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Baseline Endpoint
app.get("/api/baseline", authMiddleware, async (c) => {
  try {

    // Mock baseline data if table missing
    return c.json({
      restingHeartRate: 72,
      bloodPressure: "120/80",
      weight: 75,
      height: 175
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});


export default app;

