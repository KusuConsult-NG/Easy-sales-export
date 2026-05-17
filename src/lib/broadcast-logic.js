"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.categorizeUser = categorizeUser;
exports.getCleanBroadcastList = getCleanBroadcastList;
var firebase_admin_1 = require("./firebase-admin");
var firestore_1 = require("./types/firestore");
var logger_1 = require("./logger");
/**
 * High-Precision Mutually Exclusive Segmenter
 * Categorizes users based on their engagement depth.
 */
function categorizeUser(data) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    var regs = data.serviceRegistrations || {};
    // 1. Check for Active Engagement (Any approved/paid/completed module)
    var hasApproved = Object.values(regs).some(function (r) {
        return r.status === "approved" || r.status === "active" || r.status === "paid" || r.status === "completed";
    });
    if (hasApproved)
        return "active_users";
    // 2. Check for Pending Applications
    var hasPending = Object.values(regs).some(function (r) {
        return r.status === "pending" || r.status === "submitted" || r.status === "under_review" || r.status === "briefing";
    });
    if (hasPending)
        return "pending_users";
    // 3. Check for Stalled Progress (Started profile/KYC but no applications)
    var hasStartedAny = Object.values(regs).some(function (r) { return r.status && r.status !== "not_started"; });
    var hasBank = (((_b = (_a = data.verificationProfile) === null || _a === void 0 ? void 0 : _a.bankDetails) === null || _b === void 0 ? void 0 : _b.bankName) && ((_d = (_c = data.verificationProfile) === null || _c === void 0 ? void 0 : _c.bankDetails) === null || _d === void 0 ? void 0 : _d.bankName) !== "N/A") || ((_e = data.bankDetails) === null || _e === void 0 ? void 0 : _e.bankName);
    var hasAddress = (((_g = (_f = data.verificationProfile) === null || _f === void 0 ? void 0 : _f.address) === null || _g === void 0 ? void 0 : _g.state) && ((_j = (_h = data.verificationProfile) === null || _h === void 0 ? void 0 : _h.address) === null || _j === void 0 ? void 0 : _j.state) !== "N/A") || ((_k = data.address) === null || _k === void 0 ? void 0 : _k.state);
    if (hasStartedAny || hasBank || hasAddress)
        return "stalled_users";
    // 4. Ghost User (No activity detected)
    return "ghost_users";
}
/**
 * Resolves the seller broadcast list EXCLUSIVELY from seller_verifications (source of truth).
 * Fetches user emails from USERS collection by userId in batches of 30.
 */
function getSellerBroadcastList(filters) {
    return __awaiter(this, void 0, void 0, function () {
        var audience, statusFilter, sellerSnap, moduleStats, sellerEntries, _i, _a, doc, d, userId, status_1, emailMap, missingEmailUserIds, CHUNK, _loop_1, i, getAuth, auth, i, chunk, result, authErr_1, uniqueList;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    audience = filters === null || filters === void 0 ? void 0 : filters.audience;
                    statusFilter = (filters === null || filters === void 0 ? void 0 : filters.moduleStatus) && filters.moduleStatus !== "all" ? filters.moduleStatus : null;
                    return [4 /*yield*/, firebase_admin_1.db.collection(firestore_1.COLLECTIONS.SELLER_VERIFICATIONS).get()];
                case 1:
                    sellerSnap = _b.sent();
                    moduleStats = { total: 0, approved: 0, pending: 0, rejected: 0, suspended: 0 };
                    sellerEntries = [];
                    for (_i = 0, _a = sellerSnap.docs; _i < _a.length; _i++) {
                        doc = _a[_i];
                        d = doc.data();
                        userId = d.userId;
                        if (!userId)
                            continue;
                        status_1 = d.status || "pending";
                        if (status_1 === "under_review")
                            status_1 = "pending";
                        moduleStats.total++;
                        if (status_1 === "approved")
                            moduleStats.approved++;
                        else if (status_1 === "pending")
                            moduleStats.pending++;
                        else if (status_1 === "rejected")
                            moduleStats.rejected++;
                        else if (status_1 === "suspended")
                            moduleStats.suspended++;
                        // Apply status filter if set
                        if (statusFilter && status_1 !== statusFilter)
                            continue;
                        sellerEntries.push({ userId: userId, status: status_1 });
                    }
                    emailMap = new Map();
                    missingEmailUserIds = [];
                    CHUNK = 30;
                    _loop_1 = function (i) {
                        var chunk, refs, userDocs;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    chunk = sellerEntries.slice(i, i + CHUNK);
                                    refs = chunk.map(function (e) { return firebase_admin_1.db.collection(firestore_1.COLLECTIONS.USERS).doc(e.userId); });
                                    return [4 /*yield*/, firebase_admin_1.db.getAll.apply(firebase_admin_1.db, refs)];
                                case 1:
                                    userDocs = _c.sent();
                                    userDocs.forEach(function (userDoc, idx) {
                                        var _a, _b, _c;
                                        if (!userDoc.exists) {
                                            // User doc missing entirely — try Auth fallback
                                            missingEmailUserIds.push(chunk[idx].userId);
                                            return;
                                        }
                                        var d = userDoc.data();
                                        var rawEmail = d.email || d.userEmail;
                                        if (!rawEmail) {
                                            // User doc exists but has no email — try Auth fallback
                                            missingEmailUserIds.push(userDoc.id);
                                            return;
                                        }
                                        var normalizedEmail = rawEmail.toLowerCase().trim();
                                        if (emailMap.has(normalizedEmail))
                                            return;
                                        var lastActiveRaw = d.updatedAt || d.createdAt;
                                        emailMap.set(normalizedEmail, {
                                            uid: userDoc.id,
                                            email: normalizedEmail,
                                            name: d.fullName || d.firstName || "Member",
                                            state: d.state || d.stateOfOrigin || ((_a = d.address) === null || _a === void 0 ? void 0 : _a.state) || ((_c = (_b = d.verificationProfile) === null || _b === void 0 ? void 0 : _b.address) === null || _c === void 0 ? void 0 : _c.state) || "Unknown",
                                            onboardingCompleted: d.onboardingCompleted || false,
                                            lastActive: (lastActiveRaw === null || lastActiveRaw === void 0 ? void 0 : lastActiveRaw.toDate) ? lastActiveRaw.toDate() : (lastActiveRaw ? new Date(lastActiveRaw) : new Date()),
                                        });
                                    });
                                    return [2 /*return*/];
                            }
                        });
                    };
                    i = 0;
                    _b.label = 2;
                case 2:
                    if (!(i < sellerEntries.length)) return [3 /*break*/, 5];
                    return [5 /*yield**/, _loop_1(i)];
                case 3:
                    _b.sent();
                    _b.label = 4;
                case 4:
                    i += CHUNK;
                    return [3 /*break*/, 2];
                case 5:
                    if (!(missingEmailUserIds.length > 0)) return [3 /*break*/, 12];
                    logger_1.logger.info("[BroadcastLogic][Sellers] Falling back to Firebase Auth for ".concat(missingEmailUserIds.length, " sellers with no USERS email..."));
                    return [4 /*yield*/, Promise.resolve().then(function () { return require("firebase-admin/auth"); })];
                case 6:
                    getAuth = (_b.sent()).getAuth;
                    auth = getAuth();
                    i = 0;
                    _b.label = 7;
                case 7:
                    if (!(i < missingEmailUserIds.length)) return [3 /*break*/, 12];
                    chunk = missingEmailUserIds.slice(i, i + 100);
                    _b.label = 8;
                case 8:
                    _b.trys.push([8, 10, , 11]);
                    return [4 /*yield*/, auth.getUsers(chunk.map(function (uid) { return ({ uid: uid }); }))];
                case 9:
                    result = _b.sent();
                    result.users.forEach(function (authUser) {
                        if (!authUser.email)
                            return;
                        var normalizedEmail = authUser.email.toLowerCase().trim();
                        if (emailMap.has(normalizedEmail))
                            return;
                        emailMap.set(normalizedEmail, {
                            uid: authUser.uid,
                            email: normalizedEmail,
                            name: authUser.displayName || "Member",
                            state: "Unknown",
                            onboardingCompleted: false,
                            lastActive: new Date(),
                        });
                    });
                    return [3 /*break*/, 11];
                case 10:
                    authErr_1 = _b.sent();
                    logger_1.logger.error("[BroadcastLogic][Sellers] Auth fallback error:", authErr_1);
                    return [3 /*break*/, 11];
                case 11:
                    i += 100;
                    return [3 /*break*/, 7];
                case 12:
                    uniqueList = Array.from(emailMap.values());
                    logger_1.logger.info("[BroadcastLogic][Sellers] seller_verifications: ".concat(sellerSnap.size, ", matched entries: ").concat(sellerEntries.length, ", unique emails: ").concat(uniqueList.length));
                    return [2 /*return*/, {
                            success: true,
                            error: null,
                            data: {
                                recipients: uniqueList,
                                count: uniqueList.length,
                                originalDocCount: sellerSnap.size,
                                moduleStats: moduleStats,
                            },
                        }];
            }
        });
    });
}
function getAbandonedFailedBroadcastList(filters) {
    return __awaiter(this, void 0, void 0, function () {
        var emailMap, moduleStats, snap, userIdsToResolve, _i, _a, doc, data, rawEmail, rawName, failedAt, lastActive, normalizedEmail, uniqueIds, missingAuthIds_1, _loop_2, i, getAuth, auth, i, chunk, result, authErr_2, uniqueList;
        var _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    logger_1.logger.info("[BroadcastLogic] Generating abandoned/failed transactions list...");
                    emailMap = new Map();
                    moduleStats = { total: 0, approved: 0, pending: 0, rejected: 0, suspended: 0 };
                    return [4 /*yield*/, firebase_admin_1.db.collection(firestore_1.COLLECTIONS.FAILED_PAYMENTS).get()];
                case 1:
                    snap = _d.sent();
                    userIdsToResolve = [];
                    for (_i = 0, _a = snap.docs; _i < _a.length; _i++) {
                        doc = _a[_i];
                        data = doc.data();
                        rawEmail = data.customerEmail || data.email || ((_b = data.metadata) === null || _b === void 0 ? void 0 : _b.email);
                        rawName = data.customerName || data.name || ((_c = data.metadata) === null || _c === void 0 ? void 0 : _c.name) || "User";
                        failedAt = data.failedAt || data.abandonedAt;
                        lastActive = (failedAt === null || failedAt === void 0 ? void 0 : failedAt.toDate) ? failedAt.toDate() : (failedAt ? new Date(failedAt) : new Date());
                        if (rawEmail) {
                            normalizedEmail = rawEmail.toLowerCase().trim();
                            if (!emailMap.has(normalizedEmail)) {
                                emailMap.set(normalizedEmail, {
                                    uid: data.userId || doc.id,
                                    email: normalizedEmail,
                                    name: rawName,
                                    state: "Unknown",
                                    onboardingCompleted: false,
                                    lastActive: lastActive,
                                });
                            }
                        }
                        else if (data.userId) {
                            userIdsToResolve.push(data.userId);
                        }
                    }
                    logger_1.logger.info("[BroadcastLogic][AbandonedFailed] snap.size=".concat(snap.size, ", from_email=").concat(emailMap.size, ", userIds_to_resolve=").concat(userIdsToResolve.length));
                    if (!(userIdsToResolve.length > 0)) return [3 /*break*/, 13];
                    uniqueIds = Array.from(new Set(userIdsToResolve));
                    missingAuthIds_1 = [];
                    _loop_2 = function (i) {
                        var chunk, snaps;
                        return __generator(this, function (_e) {
                            switch (_e.label) {
                                case 0:
                                    chunk = uniqueIds.slice(i, i + 100);
                                    return [4 /*yield*/, firebase_admin_1.db.getAll.apply(firebase_admin_1.db, chunk.map(function (id) { return firebase_admin_1.db.collection(firestore_1.COLLECTIONS.USERS).doc(id); }))];
                                case 1:
                                    snaps = _e.sent();
                                    snaps.forEach(function (userSnap, idx) {
                                        var _a;
                                        if (userSnap.exists) {
                                            var u = userSnap.data();
                                            var rawEmail = (u === null || u === void 0 ? void 0 : u.email) || (u === null || u === void 0 ? void 0 : u.userEmail);
                                            if (rawEmail) {
                                                var normalizedEmail = rawEmail.toLowerCase().trim();
                                                if (!emailMap.has(normalizedEmail)) {
                                                    emailMap.set(normalizedEmail, {
                                                        uid: userSnap.id,
                                                        email: normalizedEmail,
                                                        name: (u === null || u === void 0 ? void 0 : u.fullName) || (u === null || u === void 0 ? void 0 : u.firstName) || (u === null || u === void 0 ? void 0 : u.name) || "User",
                                                        state: (u === null || u === void 0 ? void 0 : u.state) || (u === null || u === void 0 ? void 0 : u.stateOfOrigin) || ((_a = u === null || u === void 0 ? void 0 : u.address) === null || _a === void 0 ? void 0 : _a.state) || "Unknown",
                                                        onboardingCompleted: (u === null || u === void 0 ? void 0 : u.onboardingCompleted) || false,
                                                        lastActive: new Date(),
                                                    });
                                                }
                                            }
                                            else {
                                                // User doc exists but no email field — try Auth fallback
                                                missingAuthIds_1.push(userSnap.id);
                                            }
                                        }
                                        else {
                                            // User doc missing entirely — try Auth fallback
                                            missingAuthIds_1.push(chunk[idx]);
                                        }
                                    });
                                    return [2 /*return*/];
                            }
                        });
                    };
                    i = 0;
                    _d.label = 2;
                case 2:
                    if (!(i < uniqueIds.length)) return [3 /*break*/, 5];
                    return [5 /*yield**/, _loop_2(i)];
                case 3:
                    _d.sent();
                    _d.label = 4;
                case 4:
                    i += 100;
                    return [3 /*break*/, 2];
                case 5:
                    if (!(missingAuthIds_1.length > 0)) return [3 /*break*/, 13];
                    logger_1.logger.info("[BroadcastLogic][AbandonedFailed] Auth fallback for ".concat(missingAuthIds_1.length, " users..."));
                    _d.label = 6;
                case 6:
                    _d.trys.push([6, 12, , 13]);
                    return [4 /*yield*/, Promise.resolve().then(function () { return require("firebase-admin/auth"); })];
                case 7:
                    getAuth = (_d.sent()).getAuth;
                    auth = getAuth();
                    i = 0;
                    _d.label = 8;
                case 8:
                    if (!(i < missingAuthIds_1.length)) return [3 /*break*/, 11];
                    chunk = missingAuthIds_1.slice(i, i + 100);
                    return [4 /*yield*/, auth.getUsers(chunk.map(function (uid) { return ({ uid: uid }); }))];
                case 9:
                    result = _d.sent();
                    result.users.forEach(function (authUser) {
                        if (!authUser.email)
                            return;
                        var normalizedEmail = authUser.email.toLowerCase().trim();
                        if (emailMap.has(normalizedEmail))
                            return;
                        emailMap.set(normalizedEmail, {
                            uid: authUser.uid,
                            email: normalizedEmail,
                            name: authUser.displayName || "User",
                            state: "Unknown",
                            onboardingCompleted: false,
                            lastActive: new Date(),
                        });
                    });
                    _d.label = 10;
                case 10:
                    i += 100;
                    return [3 /*break*/, 8];
                case 11: return [3 /*break*/, 13];
                case 12:
                    authErr_2 = _d.sent();
                    logger_1.logger.error("[BroadcastLogic][AbandonedFailed] Auth fallback error:", authErr_2);
                    return [3 /*break*/, 13];
                case 13:
                    uniqueList = Array.from(emailMap.values());
                    logger_1.logger.info("[BroadcastLogic][AbandonedFailed] FINAL: ".concat(snap.size, " payment docs -> ").concat(uniqueList.length, " unique recipients"));
                    return [2 /*return*/, {
                            success: true,
                            error: null,
                            data: {
                                recipients: uniqueList,
                                count: uniqueList.length,
                                originalDocCount: snap.size,
                                moduleStats: moduleStats,
                            },
                        }];
            }
        });
    });
}
function getUnpaidApplicantsBroadcastList(filters) {
    return __awaiter(this, void 0, void 0, function () {
        var emailMap, moduleStats, _a, coopSnap, acadSnap, userIdsToResolve, processDoc, uniqueIds, i, chunk, snaps, uniqueList;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    logger_1.logger.info("[BroadcastLogic] Generating unpaid applicants list...");
                    emailMap = new Map();
                    moduleStats = { total: 0, approved: 0, pending: 0, rejected: 0, suspended: 0 };
                    return [4 /*yield*/, Promise.all([
                            firebase_admin_1.db.collection(firestore_1.COLLECTIONS.COOPERATIVE_MEMBERS).where("paymentStatus", "in", ["pending", "unpaid", "failed"]).get(),
                            firebase_admin_1.db.collection(firestore_1.COLLECTIONS.ACADEMY_APPLICATIONS).where("paymentStatus", "in", ["pending", "unpaid", "failed"]).get(),
                        ])];
                case 1:
                    _a = _b.sent(), coopSnap = _a[0], acadSnap = _a[1];
                    userIdsToResolve = [];
                    processDoc = function (doc, isAcademy) {
                        var _a;
                        if (isAcademy === void 0) { isAcademy = false; }
                        var data = doc.data();
                        var rawEmail = data.email || data.userEmail;
                        var name = data.fullName || "".concat(data.firstName || '', " ").concat(data.lastName || '').trim() || "User";
                        var state = data.state || ((_a = data.address) === null || _a === void 0 ? void 0 : _a.state) || "Unknown";
                        if (isAcademy && data.personalInfo) {
                            rawEmail = rawEmail || data.personalInfo.email;
                            name = data.personalInfo.fullName || "".concat(data.personalInfo.firstName || '', " ").concat(data.personalInfo.lastName || '').trim() || name;
                            state = data.personalInfo.state || data.personalInfo.stateOfOrigin || state;
                        }
                        if (rawEmail) {
                            var normalizedEmail = rawEmail.toLowerCase().trim();
                            if (!emailMap.has(normalizedEmail)) {
                                emailMap.set(normalizedEmail, {
                                    uid: data.userId || doc.id,
                                    email: normalizedEmail,
                                    name: name,
                                    state: state,
                                    onboardingCompleted: false,
                                    lastActive: new Date()
                                });
                            }
                        }
                        else if (data.userId) {
                            userIdsToResolve.push(data.userId);
                        }
                    };
                    coopSnap.docs.forEach(function (d) { return processDoc(d); });
                    acadSnap.docs.forEach(function (d) { return processDoc(d, true); });
                    if (!(userIdsToResolve.length > 0)) return [3 /*break*/, 5];
                    uniqueIds = Array.from(new Set(userIdsToResolve));
                    i = 0;
                    _b.label = 2;
                case 2:
                    if (!(i < uniqueIds.length)) return [3 /*break*/, 5];
                    chunk = uniqueIds.slice(i, i + 100);
                    return [4 /*yield*/, firebase_admin_1.db.getAll.apply(firebase_admin_1.db, chunk.map(function (id) { return firebase_admin_1.db.collection(firestore_1.COLLECTIONS.USERS).doc(id); }))];
                case 3:
                    snaps = _b.sent();
                    snaps.forEach(function (userSnap) {
                        var _a;
                        if (userSnap.exists) {
                            var u = userSnap.data();
                            var rawEmail = (u === null || u === void 0 ? void 0 : u.email) || (u === null || u === void 0 ? void 0 : u.userEmail);
                            if (rawEmail) {
                                var normalizedEmail = rawEmail.toLowerCase().trim();
                                if (!emailMap.has(normalizedEmail)) {
                                    emailMap.set(normalizedEmail, {
                                        uid: userSnap.id,
                                        email: normalizedEmail,
                                        name: (u === null || u === void 0 ? void 0 : u.fullName) || (u === null || u === void 0 ? void 0 : u.name) || "User",
                                        state: (u === null || u === void 0 ? void 0 : u.state) || (u === null || u === void 0 ? void 0 : u.stateOfOrigin) || ((_a = u === null || u === void 0 ? void 0 : u.address) === null || _a === void 0 ? void 0 : _a.state) || "Unknown",
                                        onboardingCompleted: false,
                                        lastActive: new Date()
                                    });
                                }
                            }
                        }
                    });
                    _b.label = 4;
                case 4:
                    i += 100;
                    return [3 /*break*/, 2];
                case 5:
                    uniqueList = Array.from(emailMap.values());
                    logger_1.logger.info("[BroadcastLogic] unpaid applicants: coop=".concat(coopSnap.size, ", acad=").concat(acadSnap.size, ", unique emails: ").concat(uniqueList.length));
                    return [2 /*return*/, {
                            success: true,
                            error: null,
                            data: {
                                recipients: uniqueList,
                                count: uniqueList.length,
                                originalDocCount: coopSnap.size + acadSnap.size,
                                moduleStats: moduleStats,
                            },
                        }];
            }
        });
    });
}
/**
 * Core logic for generating broadcast lists.
 * This is decoupled from 'use server' and 'server-only' to allow use in Node.js scripts.
 */
function getCleanBroadcastList(filters) {
    return __awaiter(this, void 0, void 0, function () {
        var uniqueEmails, recipients, query_1, emailMap_1, totalScanned_1, matchedAudienceCount_1, missingEmailUserIds_1, moduleStats_1, getAuth, auth, _loop_3, i, uniqueList, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 7, , 8]);
                    logger_1.logger.info("[BroadcastLogic] Generating clean list using stream (Audience: ".concat((filters === null || filters === void 0 ? void 0 : filters.audience) || 'all', ")..."));
                    // --- DEDICATED CSV UPLOAD PATH ---
                    if ((filters === null || filters === void 0 ? void 0 : filters.audience) === "csv_upload") {
                        if (!filters.csvEmails || filters.csvEmails.length === 0) {
                            return [2 /*return*/, { success: false, error: "No emails provided in CSV upload.", data: null }];
                        }
                        uniqueEmails = Array.from(new Set(filters.csvEmails.map(function (e) { return e.toLowerCase().trim(); })));
                        recipients = uniqueEmails.map(function (email) { return ({
                            uid: email,
                            email: email,
                            name: "Member",
                            state: "Unknown",
                            onboardingCompleted: false,
                            lastActive: new Date()
                        }); });
                        return [2 /*return*/, {
                                success: true,
                                error: null,
                                data: {
                                    recipients: recipients,
                                    count: recipients.length,
                                    originalDocCount: filters.csvEmails.length,
                                    moduleStats: { total: 0, approved: 0, pending: 0, rejected: 0, suspended: 0 }
                                }
                            }];
                    }
                    // --- DEDICATED SELLER PATH (Source of Truth: seller_verifications collection) ---
                    if ((filters === null || filters === void 0 ? void 0 : filters.audience) === "sellers" ||
                        (filters === null || filters === void 0 ? void 0 : filters.audience) === "wholesale_sellers" ||
                        (filters === null || filters === void 0 ? void 0 : filters.audience) === "retail_sellers") {
                        return [2 /*return*/, getSellerBroadcastList(filters)];
                    }
                    // --- DEDICATED ABANDONED / FAILED TRANSACTIONS PATH ---
                    if ((filters === null || filters === void 0 ? void 0 : filters.audience) === "abandoned_failed_transactions") {
                        return [2 /*return*/, getAbandonedFailedBroadcastList(filters)];
                    }
                    // --- DEDICATED UNPAID APPLICANTS PATH ---
                    if ((filters === null || filters === void 0 ? void 0 : filters.audience) === "unpaid_applicants") {
                        return [2 /*return*/, getUnpaidApplicantsBroadcastList(filters)];
                    }
                    query_1 = firebase_admin_1.db.collection(firestore_1.COLLECTIONS.USERS)
                        .select("email", "userEmail", "fullName", "firstName", "state", "stateOfOrigin", "address", "onboardingCompleted", "updatedAt", "createdAt", "serviceRegistrations", "verificationProfile", "bankDetails", "marketplaceAccountType", "roles", "sellerVerificationStatus", "status", "isSeller");
                    emailMap_1 = new Map();
                    totalScanned_1 = 0;
                    matchedAudienceCount_1 = 0;
                    missingEmailUserIds_1 = [];
                    moduleStats_1 = {
                        total: 0,
                        approved: 0,
                        pending: 0,
                        rejected: 0,
                        suspended: 0
                    };
                    // Use streaming to handle high-scale user counts (37k+) safely
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            query_1.stream()
                                .on("data", function (doc) {
                                var _a, _b, _c, _d;
                                totalScanned_1++;
                                var data = doc.data();
                                // Delay email extraction until matchesAudience is confirmed
                                // 2. Apply Date Range Filter if present
                                if ((filters === null || filters === void 0 ? void 0 : filters.startDate) || (filters === null || filters === void 0 ? void 0 : filters.endDate)) {
                                    var created = ((_a = data.createdAt) === null || _a === void 0 ? void 0 : _a.toDate) ? data.createdAt.toDate() : new Date(data.createdAt);
                                    if (filters.startDate && created < new Date(filters.startDate))
                                        return;
                                    if (filters.endDate && created > new Date(filters.endDate))
                                        return;
                                }
                                // 3. High-Precision Audience Segmenting
                                var userSegment = categorizeUser(data);
                                var matchesAudience = false;
                                if (!filters || filters.audience === "all") {
                                    matchesAudience = true;
                                }
                                else if (filters.audience === userSegment) {
                                    matchesAudience = true;
                                }
                                else {
                                    // Fallback to legacy specific module filters
                                    var regs = data.serviceRegistrations || {};
                                    var statusFilter = filters.moduleStatus && filters.moduleStatus !== "all"
                                        ? filters.moduleStatus
                                        : null;
                                    var inModule = false;
                                    var userStatus = "";
                                    var ENROLLED_STATUSES = new Set(['pending', 'under_review', 'approved', 'active', 'paid', 'completed', 'suspended']);
                                    if (filters.audience === "marketplace_onboarded") {
                                        var mReg = regs.marketplace;
                                        if ((mReg && ENROLLED_STATUSES.has(mReg.status)) || data.marketplaceAccountType || (data.roles && (data.roles.includes("buyer") || data.roles.includes("seller")))) {
                                            inModule = true;
                                            userStatus = (mReg === null || mReg === void 0 ? void 0 : mReg.status) || "approved";
                                        }
                                    }
                                    else if (filters.audience === "buyers") {
                                        if (data.marketplaceAccountType === "buyer" || data.marketplaceAccountType === "both" || (data.roles && data.roles.includes("buyer"))) {
                                            inModule = true;
                                            userStatus = "approved";
                                        }
                                    }
                                    else if (filters.audience === "sellers" || filters.audience === "wholesale_sellers" || filters.audience === "retail_sellers") {
                                        var mReg = regs.marketplace;
                                        if (data.marketplaceAccountType === "seller" ||
                                            data.marketplaceAccountType === "both" ||
                                            (data.roles && data.roles.includes("seller")) ||
                                            data.isSeller ||
                                            data.sellerVerificationStatus ||
                                            (mReg && (mReg.accountType === "seller" || mReg.accountType === "both" || mReg.sellerCategory))) {
                                            // Best effort mapping for sellers since we are reading from USERS collection
                                            inModule = true;
                                            userStatus = (mReg === null || mReg === void 0 ? void 0 : mReg.status) || data.sellerVerificationStatus || "approved";
                                            // Normalize under_review to pending so it fits in the 4 basic buckets (pending, approved, rejected, suspended)
                                            if (userStatus === "under_review")
                                                userStatus = "pending";
                                        }
                                    }
                                    else if (filters.audience === "cooperative_members") {
                                        var cReg = regs.cooperative;
                                        if (cReg) {
                                            inModule = true;
                                            userStatus = cReg.status || "pending";
                                        }
                                    }
                                    else if (filters.audience === "wave_applicants") {
                                        var wReg = regs.wave;
                                        if (wReg) {
                                            inModule = true;
                                            userStatus = wReg.status || "pending";
                                        }
                                    }
                                    else if (filters.audience === "academy_users") {
                                        var aReg = regs.academy;
                                        if (aReg) {
                                            inModule = true;
                                            userStatus = aReg.status || "pending";
                                        }
                                    }
                                    else if (filters.audience === "farm_nation_users") {
                                        var fReg = regs.farm_nation || regs.farmNation;
                                        if (fReg) {
                                            inModule = true;
                                            userStatus = fReg.status || "pending";
                                        }
                                    }
                                    else if (filters.audience === "export_users") {
                                        var eReg = regs.export;
                                        if (eReg) {
                                            inModule = true;
                                            userStatus = eReg.status || "pending";
                                        }
                                    }
                                    if (inModule) {
                                        moduleStats_1.total++;
                                        if (userStatus === "approved")
                                            moduleStats_1.approved++;
                                        else if (userStatus === "pending")
                                            moduleStats_1.pending++;
                                        else if (userStatus === "rejected")
                                            moduleStats_1.rejected++;
                                        else if (userStatus === "suspended")
                                            moduleStats_1.suspended++;
                                        if (statusFilter === "not_approved") {
                                            matchesAudience = userStatus !== "approved";
                                        }
                                        else {
                                            matchesAudience = statusFilter ? userStatus === statusFilter : true;
                                        }
                                    }
                                    else {
                                        if (filters.audience === "pending_applicants") {
                                            matchesAudience = Object.values(regs).some(function (r) { return r.status === "pending" || r.status === "submitted"; });
                                        }
                                        else if (filters.audience === "unpaid_applicants") {
                                            matchesAudience = Object.values(regs).some(function (r) { return r.paymentStatus === "pending" || r.paymentStatus === "failed"; });
                                        }
                                        else if (filters.audience === "abandoned_failed_transactions") {
                                            matchesAudience = Object.values(regs).some(function (r) { return r.paymentStatus === "failed" || r.paymentStatus === "abandoned"; });
                                        }
                                    }
                                }
                                if (matchesAudience) {
                                    matchedAudienceCount_1++;
                                    // Handle missing email fallback
                                    var rawEmail = data.email || data.userEmail;
                                    if (!rawEmail) {
                                        missingEmailUserIds_1.push({ uid: doc.id, data: data });
                                        return;
                                    }
                                    var normalizedEmail = rawEmail.toLowerCase().trim();
                                    // 4. Deduplication
                                    if (!emailMap_1.has(normalizedEmail)) {
                                        var lastActiveRaw = data.updatedAt || data.createdAt;
                                        emailMap_1.set(normalizedEmail, {
                                            uid: doc.id,
                                            email: normalizedEmail,
                                            name: data.fullName || data.firstName || 'Member',
                                            state: data.state || data.stateOfOrigin || ((_b = data.address) === null || _b === void 0 ? void 0 : _b.state) || ((_d = (_c = data.verificationProfile) === null || _c === void 0 ? void 0 : _c.address) === null || _d === void 0 ? void 0 : _d.state) || 'Unknown',
                                            onboardingCompleted: data.onboardingCompleted || false,
                                            lastActive: (lastActiveRaw === null || lastActiveRaw === void 0 ? void 0 : lastActiveRaw.toDate) ? lastActiveRaw.toDate() : (lastActiveRaw ? new Date(lastActiveRaw) : new Date())
                                        });
                                    }
                                }
                            })
                                .on("end", resolve)
                                .on("error", reject);
                        })];
                case 1:
                    // Use streaming to handle high-scale user counts (37k+) safely
                    _a.sent();
                    if (!(missingEmailUserIds_1.length > 0)) return [3 /*break*/, 6];
                    logger_1.logger.info("[BroadcastLogic] Falling back to Firebase Auth for ".concat(missingEmailUserIds_1.length, " users with no USERS email..."));
                    return [4 /*yield*/, Promise.resolve().then(function () { return require("firebase-admin/auth"); })];
                case 2:
                    getAuth = (_a.sent()).getAuth;
                    auth = getAuth();
                    _loop_3 = function (i) {
                        var chunk, result, authErr_3;
                        return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0:
                                    chunk = missingEmailUserIds_1.slice(i, i + 100);
                                    _b.label = 1;
                                case 1:
                                    _b.trys.push([1, 3, , 4]);
                                    return [4 /*yield*/, auth.getUsers(chunk.map(function (u) { return ({ uid: u.uid }); }))];
                                case 2:
                                    result = _b.sent();
                                    result.users.forEach(function (authUser) {
                                        var _a, _b, _c, _d;
                                        if (!authUser.email)
                                            return;
                                        var normalizedEmail = authUser.email.toLowerCase().trim();
                                        if (emailMap_1.has(normalizedEmail))
                                            return;
                                        var data = ((_a = chunk.find(function (c) { return c.uid === authUser.uid; })) === null || _a === void 0 ? void 0 : _a.data) || {};
                                        var lastActiveRaw = data.updatedAt || data.createdAt;
                                        emailMap_1.set(normalizedEmail, {
                                            uid: authUser.uid,
                                            email: normalizedEmail,
                                            name: authUser.displayName || data.fullName || data.firstName || "Member",
                                            state: data.state || data.stateOfOrigin || ((_b = data.address) === null || _b === void 0 ? void 0 : _b.state) || ((_d = (_c = data.verificationProfile) === null || _c === void 0 ? void 0 : _c.address) === null || _d === void 0 ? void 0 : _d.state) || "Unknown",
                                            onboardingCompleted: data.onboardingCompleted || false,
                                            lastActive: (lastActiveRaw === null || lastActiveRaw === void 0 ? void 0 : lastActiveRaw.toDate) ? lastActiveRaw.toDate() : (lastActiveRaw ? new Date(lastActiveRaw) : new Date()),
                                        });
                                    });
                                    return [3 /*break*/, 4];
                                case 3:
                                    authErr_3 = _b.sent();
                                    logger_1.logger.error("[BroadcastLogic] Auth fallback error:", authErr_3);
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                            }
                        });
                    };
                    i = 0;
                    _a.label = 3;
                case 3:
                    if (!(i < missingEmailUserIds_1.length)) return [3 /*break*/, 6];
                    return [5 /*yield**/, _loop_3(i)];
                case 4:
                    _a.sent();
                    _a.label = 5;
                case 5:
                    i += 100;
                    return [3 /*break*/, 3];
                case 6:
                    logger_1.logger.info("[BroadcastLogic] Clean Sweep complete. Scanned: ".concat(totalScanned_1, ", Matched: ").concat(matchedAudienceCount_1, ", Unique: ").concat(emailMap_1.size));
                    uniqueList = Array.from(emailMap_1.values());
                    return [2 /*return*/, {
                            success: true,
                            error: null,
                            data: {
                                recipients: uniqueList,
                                count: uniqueList.length,
                                originalDocCount: totalScanned_1,
                                moduleStats: moduleStats_1
                            }
                        }];
                case 7:
                    error_1 = _a.sent();
                    logger_1.logger.error("[BroadcastLogic] List generation failed:", error_1);
                    return [2 /*return*/, { success: false, error: "Failed to generate broadcast list.", data: null }];
                case 8: return [2 /*return*/];
            }
        });
    });
}
