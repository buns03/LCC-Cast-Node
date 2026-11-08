/**
 * ONE place that says which tables/columns the login uses.
 *
 * All names below are VERIFIED against your real Supabase schema dump
 * (user_profiles, voters, campuses) and your Voter / Campus / UserProfile entities.
 * If the database ever changes, fix the names here only.
 */
export const T = {
  userProfiles: 'user_profiles',

  voters: 'voters',
  voterCols: {
    authUserId: 'auth_user_id',
    status: 'status',
    campusId: 'campus_id',
    programCourse: 'program_course',
    email: 'email',
  },

  emailOtps: 'email_otps',

  campuses: 'campuses',
  campusCols: {
    id: 'id',
    name: 'name',
  },
};

export const USER_PROFILE_COLUMNS = [
  'id',
  'auth_user_id',
  'role',
  'campus_id',
  'department_id',
  'admin_department',
  'school_id',
  'email',
  'first_name',
  'last_name',
  'is_active',
  'status',
  'last_login_at',
  'must_change_password',
  'admin_type',
];

/**
 * Candidate portal tables/columns. Change names here only.
 * VERIFIED   = already used by working Node code.
 * UNVERIFIED = guessed from the Java field names (camelCase -> snake_case). Check against the entities.
 */
export const CANDIDATE_PORTAL = {
  tables: {
    candidates: 'candidates',                // VERIFIED
    partylistMembers: 'partylist_members',   // VERIFIED
    departmentMembers: 'department_members', // VERIFIED
    partylists: 'partylists',                // VERIFIED
    departments: 'departments',              // VERIFIED
  },
  // same column names are used for candidates / partylist_members / department_members
  recordCols: {
    id: 'id',                                // UNVERIFIED
    studentId: 'student_id',                 // VERIFIED
    lastName: 'last_name',                   // UNVERIFIED
    firstName: 'first_name',                 // UNVERIFIED
    middleName: 'middle_name',               // UNVERIFIED
    position: 'position',                    // UNVERIFIED
    photo: 'photo_image_url',                // VERIFIED
    background: 'background_image_url',      // VERIFIED
    campaign: 'campaign_image_url',          // VERIFIED
  },
  // same column names are used for partylists / departments
  groupCols: {
    id: 'id',                                // VERIFIED
    name: 'name',                            // VERIFIED (departments), UNVERIFIED (partylists)
    description: 'description',              // UNVERIFIED
    poster: 'poster_image_url',              // UNVERIFIED
    logo: 'poster_logo_url',                 // UNVERIFIED
    schoolYear: 'school_year',               // UNVERIFIED
  },
};