import express, { NextFunction, Request, Response } from "express";
import session from "express-session";
import path from "path";
import { config } from "./config";
import { sessionStore } from "./auth/sessions";
import { landingFor } from "./auth/landing";
import { loginRouter } from "./routes/login";
import { pagesRouter } from "./routes/pages";
import { forgotPasswordRouter } from "./routes/forgotPassword";
import { passwordRouter } from "./routes/password";
import { superadminRouter } from "./routes/superadmin";
import { superadminElectionsRouter } from "./routes/superadminElections";
import { superadminVotersRouter } from "./routes/superadminVoters";
import { storageRouter } from "./routes/storage";
import { startSchedulers } from "./schedulers";
import { startSocketServer } from "./socketServer";
import { superadminPartylistsRouter } from "./routes/superadminPartylists";
import { superadminDepartmentsRouter } from "./routes/superadminDepartments";
import { superadminLiveResultsRouter } from "./routes/superadminLiveResults";
import { startLiveResultsBroadcaster } from "./liveResultsBroadcaster";
import { superadminAnalyticsRouter } from "./routes/superadminAnalytics";
import { startAnalyticsBroadcaster } from "./analyticsBroadcaster";
import { requireAny } from "./auth/guards";
import "./types";
import { jobsRouter } from "./routes/jobs";
import { adminAnalyticsRouter } from "./routes/adminAnalytics";
import { superadminHistoryRouter } from "./routes/superadminHistory";
import { startHistoryBroadcaster } from "./historyBroadcaster";
import { superadminSettingsRouter } from "./routes/superadminSettings";
import { superadminProfilePictureRouter } from "./routes/superadminProfilePicture";
import { adminDeptRouter } from "./routes/adminDept";
import { adminDeptElectionsRouter } from "./routes/adminDeptElections";
import { adminDeptDepartmentsRouter } from "./routes/adminDeptDepartments";
import { adminDeptLiveResultsRouter } from "./routes/adminDeptLiveResults";
import { adminDeptVotersRouter } from "./routes/adminDeptVoters";
import { adminDeptHistoryRouter } from "./routes/adminDeptHistory";
import { adminDeptSettingsRouter } from "./routes/adminDeptSettings";
import { adminSscRouter } from "./routes/adminSsc";
import { adminSscElectionsRouter } from "./routes/adminSscElections";
import { adminSscLiveResultsRouter } from "./routes/adminSscLiveResults";
import { adminSscPartylistsRouter } from "./routes/adminSscPartylists";
import { adminSscVotersRouter } from "./routes/adminSscVoters";
import { adminSscAnalyticsRouter } from "./routes/adminSscAnalytics";
import { adminSscHistoryRouter } from "./routes/adminSscHistory";
import { adminSscSettingsRouter } from "./routes/adminSscSettings";
import { candidateRouter } from "./routes/candidate";
import { voterRouter } from "./routes/voter";
import { systemConfigRouter } from "./routes/systemConfig";
import { refreshProgramResolver } from "./programResolver";
import { corsMiddleware, blockForeignOrigins } from './cors';

const app = express();

app.set("trust proxy", 1); // needed when hosted behind Render's proxy
app.disable("x-powered-by");

app.set("trust proxy", 1); // needed when hosted behind Render's proxy
app.disable("x-powered-by");

app.use(corsMiddleware);
app.use(blockForeignOrigins);

app.use(express.json({ limit: "25mb" }));;
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "lccast.sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: "auto",
      maxAge: 7 * 24 * 60 * 60 * 1000, // server.servlet.session.timeout=7d
    },
  }),
);

// Public static files (same as /css/**, /js/**, /images/**, /favicon.ico)
app.use(express.static(path.join(__dirname, "..", "public")));

// FileUploadConfig: /uploads/partylists/** is served from the local folder uploads/partylists/ (login required)
app.use(
  "/uploads/partylists",
  requireAny(),
  express.static(path.resolve("uploads", "partylists")),
);

app.use(loginRouter);
app.use(storageRouter); // /api/storage/file, /files/**
app.use(forgotPasswordRouter); // public: /forgot-password/**
app.use(passwordRouter); // /voter/password-handler, /voter/change-password
app.use(superadminRouter); // /superadmin/dashboard + /superadmin/api/dashboard
app.use(superadminLiveResultsRouter); // /superadmin/live-results + /superadmin/live-results/data
app.use(superadminAnalyticsRouter); // NEW: /superadmin/analytics + /api/superadmin/analytics/**
app.use(superadminSettingsRouter);
app.use(systemConfigRouter); // /api/config/options + /superadmin/api/system-config/**
app.use(superadminProfilePictureRouter); // POST /superadmin/settings/profile-picture
app.use(superadminHistoryRouter);
app.use(adminAnalyticsRouter); // NEW: /admin-ssc/api/analytics/** + /api/admin-dept/analytics
app.use(superadminDepartmentsRouter); // /superadmin/departments + /superadmin/api/departments/**
app.use(superadminPartylistsRouter); // /superadmin/partylists + /superadmin/api/partylists/**
app.use(superadminElectionsRouter); // /superadmin/elections + /superadmin/api/elections/**
app.use(adminDeptRouter);
app.use(adminDeptElectionsRouter);
app.use(adminDeptDepartmentsRouter);
app.use(adminDeptLiveResultsRouter);
app.use(adminDeptVotersRouter);
app.use(adminDeptHistoryRouter); // /api/admin-dept/history/**
app.use(adminDeptSettingsRouter); // /admin-dept/settings (+ profile-picture once added)
app.use(pagesRouter); // keep BEFORE jobs + voters: its /superadmin guard protects them
app.use(adminSscRouter); // /admin-ssc/dashboard + /admin-ssc/api/dashboard
app.use(adminSscElectionsRouter); // /admin-ssc/elections + /admin-ssc/api/elections/**
app.use(adminSscLiveResultsRouter); // /admin-ssc/live-results + /admin-ssc/live-results/data
app.use(adminSscPartylistsRouter); // /admin-ssc/partylists + /admin-ssc/api/partylists/**
app.use(adminSscVotersRouter); // /admin-ssc/voters + /admin-ssc/api/voters/**
app.use(adminSscAnalyticsRouter); // /admin-ssc/analytics + /admin-ssc/api/analytics (+ /history)
app.use(adminSscHistoryRouter); // /admin-ssc/history + /admin-ssc/api/history/**
app.use(adminSscSettingsRouter); // /admin-ssc/settings (+ /profile-picture)
app.use(jobsRouter);
app.use(candidateRouter);
app.use(voterRouter); // /voter/ssc-election, /voter/settings, /voter/vote-summaries, /voter/api/elections/**
app.use(superadminVotersRouter); // /superadmin/voters + /superadmin/api/voters/**

// Anything unknown -> back to the user's landing page (like AppErrorController)
app.use((req: Request, res: Response) => {
  if (req.originalUrl.includes("/api/")) {
    return res.status(404).json({ success: false, message: "Not found" });
  }
  res.redirect(landingFor(req.session.user));
});

// Real server errors
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).send("Something went wrong on the server.");
});

const server = app.listen(config.port, () => {
  console.log(`LCC Cast running at http://localhost:${config.port}`);
  refreshProgramResolver().catch((e) =>
    console.error("Could not load programs:", e),
  );
  startSchedulers();
});

startSocketServer(server);
startLiveResultsBroadcaster();
startAnalyticsBroadcaster();
startHistoryBroadcaster();
