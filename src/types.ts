import "express-session";

export type UserRole = "SUPERADMIN" | "ADMIN" | "CANDIDATE" | "STUDENT";

export interface UserProfile {
  id: string;
  authUserId: string | null;
  role: UserRole;
  campusId: string | null;
  departmentId: string | null;
  adminDepartment: string | null;
  schoolId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  active: boolean;
  status: string | null;
  lastLoginAt: Date | null;
  mustChangePassword: boolean;
  adminType: string | null; // 'DEPARTMENT' | 'SSC' | null
}

/** What we remember about a logged-in user (replaces Spring's session attributes). */
export interface SessionUser {
  userId: string | null;
  authUserId: string | null;
  schoolId: string | null;
  firstName: string | null;
  role: UserRole;
  adminType: string | null;
  campus: string | null;
  campusId: string | null;
  programCourse: string | null;
  mustChangePassword: boolean;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    pendingMfa?: { email: string; authUserId: string; expiresAt: number };
  }
}
