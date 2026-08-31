import { Router } from "express";
import { Prisma, TriageCaseStatus, UserRole } from "@prisma/client";
import { AuthenticatedRequest, requireDoctor } from "../middleware/auth";
import { createAuditLog } from "../services/auditLog";
import prisma from "../lib/prisma";
import { markCaseReviewed } from "../jobs/triageEscalation";
import { sendToUser } from "../services/websocket";
import {
  generatePrescriptionPdf,
  generateReferralPdf,
} from "../services/documentGenerator";
import {
  notifyPrescriptionReady,
  notifyTriageApproved,
  notifyTriageOverride,
  notifyTriageReferred,
} from "../services/notifications";
import {
  buildTriageAttachmentUrl,
  materializeTriageAttachment,
  parseTriageAttachmentManifest,
} from "../services/triageAttachments";
import {
  buildPrescriptionSafetySummary,
  buildReviewSafetySummary,
  extractMedicalPassportData,
} from "../services/triageSafetyChecks";

const router: Router = Router();

const triageCaseInclude = {
  patient: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      dateOfBirth: true,
      gender: true,
      riskProfile: true,
    },
  },
  doctor: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      hcpsaNumber: true,
      hcpsaVerified: true,
    },
  },
} as const;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function decorateTriageCase<T extends { id: string; imageStorageRef?: string | null }>(
  triageCase: T,
) {
  const manifest = parseTriageAttachmentManifest(triageCase.imageStorageRef);
  const patient = (triageCase as any).patient;
  const medicalPassport = patient
    ? extractMedicalPassportData({
        riskProfile: patient.riskProfile,
        dateOfBirth: patient.dateOfBirth,
        gender: patient.gender,
      })
    : null;
  const reviewSafety = patient
    ? buildReviewSafetySummary({
        riskProfile: patient.riskProfile,
        dateOfBirth: patient.dateOfBirth,
        gender: patient.gender,
      })
    : null;

  return {
    ...triageCase,
    followUpQuestions: asStringArray((triageCase as any).followUpQuestions),
    requestedInvestigations: asStringArray(
      (triageCase as any).requestedInvestigations,
    ),
    medicalPassport,
    reviewSafety,
    attachments: manifest.attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
      createdAt: attachment.createdAt,
      url: buildTriageAttachmentUrl(triageCase.id, attachment.id),
    })),
  };
}

function canAccessCase(
  user: NonNullable<AuthenticatedRequest["user"]>,
  triageCase: { patientId: string; doctorId: string | null },
) {
  return (
    user.role === UserRole.ADMIN ||
    triageCase.patientId === user.id ||
    triageCase.doctorId === user.id
  );
}

function getQueueWhere(
  userId: string,
  rawStatus: string,
): Prisma.TriageCaseWhereInput {
  const status = rawStatus.toUpperCase();

  if (status === "ALL") {
    return {
      OR: [
        { status: TriageCaseStatus.PENDING_REVIEW, doctorId: null },
        {
          doctorId: userId,
          status: {
            in: [
              TriageCaseStatus.ASSIGNED,
              TriageCaseStatus.AWAITING_PATIENT_RESPONSE,
              TriageCaseStatus.REVIEWED,
            ],
          },
        },
      ],
    };
  }

  if (status === "MINE") {
    return {
      doctorId: userId,
      status: {
        in: [
          TriageCaseStatus.ASSIGNED,
          TriageCaseStatus.AWAITING_PATIENT_RESPONSE,
          TriageCaseStatus.REVIEWED,
          TriageCaseStatus.RELEASED,
          TriageCaseStatus.PRESCRIPTION_ISSUED,
          TriageCaseStatus.EMERGENCY_REFERRAL,
        ],
      },
    };
  }

  if (status === "PENDING_REVIEW") {
    return { status: TriageCaseStatus.PENDING_REVIEW, doctorId: null };
  }

  if (
    status === "ASSIGNED" ||
    status === "REVIEWED" ||
    status === "AWAITING_PATIENT_RESPONSE"
  ) {
    return {
      status: (() => {
        if (status === "ASSIGNED") return TriageCaseStatus.ASSIGNED;
        if (status === "REVIEWED") return TriageCaseStatus.REVIEWED;
        return TriageCaseStatus.AWAITING_PATIENT_RESPONSE;
      })(),
      doctorId: userId,
    };
  }

  return { status: TriageCaseStatus.PENDING_REVIEW, doctorId: null };
}

async function getDoctorProfile(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      hcpsaNumber: true,
      hcpsaVerified: true,
    },
  });
}

router.get("/", requireDoctor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const status = String(req.query.status ?? "PENDING_REVIEW");
    const cases = await prisma.triageCase.findMany({
      where: getQueueWhere(req.user!.id, status),
      include: triageCaseInclude,
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    });

    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: "LIST",
      resource: "TriageCaseReview",
      metadata: { count: cases.length, status },
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
    });

    res.json({ success: true, cases: cases.map(decorateTriageCase) });
  } catch (error) {
    next(error);
  }
});

router.get(
  "/pending",
  requireDoctor,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const cases = await prisma.triageCase.findMany({
        where: { status: TriageCaseStatus.PENDING_REVIEW, doctorId: null },
        include: triageCaseInclude,
        orderBy: { createdAt: "asc" },
      });

      await createAuditLog({
        userId: req.user!.id,
        userRole: req.user!.role,
        action: "LIST",
        resource: "TriageCaseReview",
        metadata: { count: cases.length, status: "PENDING_REVIEW" },
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
      });

      res.json({ success: true, cases: cases.map(decorateTriageCase) });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/:id/claim",
  requireDoctor,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const triageCase = await prisma.triageCase.findUnique({ where: { id } });

      if (!triageCase) {
        return res.status(404).json({ error: "Triage case not found" });
      }

      if (
        triageCase.status !== TriageCaseStatus.PENDING_REVIEW &&
        !(triageCase.status === TriageCaseStatus.ASSIGNED && triageCase.doctorId === req.user!.id)
      ) {
        return res.status(400).json({ error: "Case is not available for claim" });
      }

      if (triageCase.doctorId && triageCase.doctorId !== req.user!.id) {
        return res.status(403).json({ error: "Case already claimed by another doctor" });
      }

      const updated = await prisma.triageCase.update({
        where: { id },
        data: { doctorId: req.user!.id, status: TriageCaseStatus.ASSIGNED },
        include: triageCaseInclude,
      });

      await createAuditLog({
        userId: req.user!.id,
        userRole: req.user!.role,
        action: "UPDATE",
        resource: "TriageCaseReview",
        resourceId: id,
        metadata: {
          oldStatus: triageCase.status,
          newStatus: "ASSIGNED",
          doctorId: req.user!.id,
        },
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
      });

      res.json({ success: true, triageCase: decorateTriageCase(updated) });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/:id/request-follow-up",
  requireDoctor,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const requestType = String(req.body?.requestType ?? "MORE_INFO").trim().toUpperCase();
      const message = String(req.body?.message ?? "").trim();
      const questions = asStringArray(req.body?.questions);
      const investigations = asStringArray(req.body?.requestedInvestigations);

      if (!["MORE_INFO", "INVESTIGATION"].includes(requestType)) {
        return res.status(400).json({ error: "Invalid follow-up request type" });
      }
      if (!message && questions.length === 0 && investigations.length === 0) {
        return res.status(400).json({
          error: "Provide a patient-facing message, question, or requested investigation",
        });
      }

      const triageCase = await prisma.triageCase.findUnique({
        where: { id },
        include: triageCaseInclude,
      });
      if (!triageCase) {
        return res.status(404).json({ error: "Triage case not found" });
      }
      if (triageCase.doctorId && triageCase.doctorId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const updated = await prisma.triageCase.update({
        where: { id },
        data: {
          doctorId: req.user!.id,
          status: TriageCaseStatus.AWAITING_PATIENT_RESPONSE,
          followUpRequestType: requestType,
          followUpRequestMessage: message || null,
          followUpQuestions: questions,
          requestedInvestigations: investigations,
          followUpRequestedAt: new Date(),
          patientFollowUpResponse: null,
          patientRespondedAt: null,
        },
        include: triageCaseInclude,
      });

      sendToUser(updated.patientId, {
        type: "TRIAGE_FOLLOW_UP_REQUESTED",
        data: {
          triageCaseId: updated.id,
          requestType,
          message,
          questions,
          requestedInvestigations: investigations,
          requestedAt: updated.followUpRequestedAt?.toISOString(),
        },
      });

      await createAuditLog({
        userId: req.user!.id,
        userRole: req.user!.role,
        action: "UPDATE",
        resource: "TriageCaseReview",
        resourceId: id,
        metadata: {
          actionType: "FOLLOW_UP_REQUESTED",
          requestType,
          questionCount: questions.length,
          investigationCount: investigations.length,
        },
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
      });

      res.json({ success: true, triageCase: decorateTriageCase(updated) });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/:id/review",
  requireDoctor,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const {
        doctorNotes,
        doctorDiagnosis,
        doctorRecommendations,
        finalTriageLevel,
        overrideReason,
      } = req.body ?? {};

      if (!doctorNotes?.trim() || !doctorDiagnosis?.trim()) {
        return res
          .status(400)
          .json({ error: "Doctor notes and diagnosis are required" });
      }

      const triageCase = await prisma.triageCase.findUnique({
        where: { id },
        include: triageCaseInclude,
      });

      if (!triageCase) {
        return res.status(404).json({ error: "Triage case not found" });
      }

      if (triageCase.doctorId && triageCase.doctorId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const chosenLevel =
        Number.isInteger(finalTriageLevel) && finalTriageLevel >= 1 && finalTriageLevel <= 5
          ? finalTriageLevel
          : triageCase.aiTriageLevel;

      if (
        chosenLevel !== triageCase.aiTriageLevel &&
        typeof overrideReason !== "string"
      ) {
        return res
          .status(400)
          .json({ error: "Override reason is required when changing the AI triage level" });
      }

      const updated = await prisma.triageCase.update({
        where: { id },
        data: {
          doctorId: req.user!.id,
          doctorNotes: doctorNotes.trim(),
          doctorDiagnosis: doctorDiagnosis.trim(),
          doctorRecommendations: doctorRecommendations?.trim() || null,
          finalDiagnosis: doctorDiagnosis.trim(),
          finalTriageLevel: chosenLevel,
          overrideReason:
            chosenLevel !== triageCase.aiTriageLevel ? overrideReason.trim() : null,
          status: TriageCaseStatus.REVIEWED,
          reviewedAt: new Date(),
        },
        include: triageCaseInclude,
      });

      await markCaseReviewed(id, req.user!.id);

      await createAuditLog({
        userId: req.user!.id,
        userRole: req.user!.role,
        action: "UPDATE",
        resource: "TriageCaseReview",
        resourceId: id,
        metadata: {
          oldStatus: triageCase.status,
          newStatus: "REVIEWED",
          finalTriageLevel: chosenLevel,
          overridden: chosenLevel !== triageCase.aiTriageLevel,
        },
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
      });

      res.json({ success: true, triageCase: decorateTriageCase(updated) });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/:id/release",
  requireDoctor,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const triageCase = await prisma.triageCase.findUnique({
        where: { id },
        include: triageCaseInclude,
      });

      if (!triageCase) {
        return res.status(404).json({ error: "Triage case not found" });
      }

      if (triageCase.doctorId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (triageCase.status !== TriageCaseStatus.REVIEWED) {
        return res.status(400).json({ error: "Case must be reviewed before release" });
      }

      const updated = await prisma.triageCase.update({
        where: { id },
        data: { status: TriageCaseStatus.RELEASED, releasedAt: new Date() },
        include: triageCaseInclude,
      });

      sendToUser(updated.patientId, {
        type: "TRIAGE_RESULT_RELEASED",
        data: {
          triageCaseId: updated.id,
          triageLevel: updated.finalTriageLevel ?? updated.aiTriageLevel,
          recommendedAction: updated.aiRecommendedAction,
          possibleConditions: asStringArray(updated.aiPossibleConditions),
          doctorNotes: updated.doctorNotes,
          doctorDiagnosis: updated.doctorDiagnosis ?? updated.finalDiagnosis,
          doctorRecommendations: updated.doctorRecommendations,
          wasOverridden:
            (updated.finalTriageLevel ?? updated.aiTriageLevel) !== updated.aiTriageLevel,
          releasedAt: updated.releasedAt?.toISOString(),
        },
      });

      if (updated.patient?.email) {
        const overridden =
          (updated.finalTriageLevel ?? updated.aiTriageLevel) !== updated.aiTriageLevel;
        if (overridden) {
          await notifyTriageOverride({
            to: updated.patient.email,
            patientName: updated.patient.firstName,
            doctorNotes: updated.doctorNotes ?? undefined,
            finalDiagnosis:
              updated.doctorDiagnosis ?? updated.finalDiagnosis ?? undefined,
          });
        } else {
          await notifyTriageApproved({
            to: updated.patient.email,
            patientName: updated.patient.firstName,
            finalDiagnosis:
              updated.doctorDiagnosis ??
              updated.finalDiagnosis ??
              updated.aiRecommendedAction,
          });
        }
      }

      await createAuditLog({
        userId: req.user!.id,
        userRole: req.user!.role,
        action: "UPDATE",
        resource: "TriageCaseReview",
        resourceId: id,
        metadata: { oldStatus: triageCase.status, newStatus: "RELEASED" },
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
      });

      res.json({ success: true, triageCase: decorateTriageCase(updated) });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/:id/attachments/:attachmentId",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id, attachmentId } = req.params;
      const triageCase = await prisma.triageCase.findUnique({
        where: { id },
        select: {
          id: true,
          patientId: true,
          doctorId: true,
          imageStorageRef: true,
        },
      });

      if (!triageCase) {
        return res.status(404).json({ error: "Triage case not found" });
      }
      if (!req.user || !canAccessCase(req.user, triageCase)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const manifest = parseTriageAttachmentManifest(triageCase.imageStorageRef);
      const attachment = manifest.attachments.find((item) => item.id === attachmentId);
      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      const { buffer } = materializeTriageAttachment(attachment);
      res.setHeader("Content-Type", attachment.mimeType);
      res.setHeader(
        "Content-Disposition",
        `${attachment.mimeType === "application/pdf" ? "inline" : "inline"}; filename="${attachment.fileName.replace(/"/g, "")}"`,
      );
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/:id/prescription",
  requireDoctor,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const { diagnosis, medications, doctorNotes } = req.body ?? {};

      if (!diagnosis?.trim() || !Array.isArray(medications) || medications.length === 0) {
        return res
          .status(400)
          .json({ error: "Diagnosis and at least one medication are required" });
      }

      const triageCase = await prisma.triageCase.findUnique({
        where: { id },
        include: triageCaseInclude,
      });
      if (!triageCase) {
        return res.status(404).json({ error: "Triage case not found" });
      }
      if (triageCase.doctorId && triageCase.doctorId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const doctor = await getDoctorProfile(req.user!.id);
      if (!doctor) {
        return res.status(404).json({ error: "Doctor profile not found" });
      }

      const safetySummary = buildPrescriptionSafetySummary({
        riskProfile: triageCase.patient?.riskProfile,
        dateOfBirth: triageCase.patient?.dateOfBirth,
        gender: triageCase.patient?.gender,
        medications: Array.isArray(medications) ? medications : [],
      });
      if (!safetySummary.canPrescribe) {
        return res.status(400).json({
          error: "Medical-passport safety checks blocked prescription issuance",
          safetySummary,
        });
      }

      const [prescription] = await prisma.$transaction([
        prisma.prescription.upsert({
          where: { triageCaseId: id },
          update: {
            diagnosis: diagnosis.trim(),
            medications,
            doctorNotes: doctorNotes?.trim() || null,
            hcpsaNumberSnapshot: doctor.hcpsaNumber,
            doctorNameSnapshot: `${doctor.firstName} ${doctor.lastName}`,
            doctorId: req.user!.id,
          },
          create: {
            triageCaseId: id,
            patientId: triageCase.patientId,
            doctorId: req.user!.id,
            diagnosis: diagnosis.trim(),
            medications,
            doctorNotes: doctorNotes?.trim() || null,
            hcpsaNumberSnapshot: doctor.hcpsaNumber,
            doctorNameSnapshot: `${doctor.firstName} ${doctor.lastName}`,
          },
        }),
        prisma.triageCase.update({
          where: { id },
          data: {
            doctorId: req.user!.id,
            doctorDiagnosis: diagnosis.trim(),
            finalDiagnosis: diagnosis.trim(),
            doctorNotes: doctorNotes?.trim() || triageCase.doctorNotes,
            status: TriageCaseStatus.PRESCRIPTION_ISSUED,
            reviewedAt: triageCase.reviewedAt ?? new Date(),
            releasedAt: new Date(),
          },
        }),
      ]);

      const downloadUrl = `/api/triage-review/${id}/prescription/pdf`;
      sendToUser(triageCase.patientId, {
        type: "PRESCRIPTION_ISSUED",
        data: {
          triageCaseId: id,
          prescriptionId: prescription.id,
          doctorName: `Dr. ${doctor.firstName} ${doctor.lastName}`,
          diagnosis: prescription.diagnosis,
          medicationCount: Array.isArray(medications) ? medications.length : 0,
          downloadUrl,
        },
      });

      if (triageCase.patient?.email) {
        await notifyPrescriptionReady({
          to: triageCase.patient.email,
          patientName: triageCase.patient.firstName,
          prescriptionSummary: diagnosis.trim(),
          instructions: doctorNotes?.trim() || undefined,
        });
      }

      await createAuditLog({
        userId: req.user!.id,
        userRole: req.user!.role,
        action: "CREATE",
        resource: "TriageCaseReview",
        resourceId: id,
        metadata: { actionType: "PRESCRIPTION_ISSUED", prescriptionId: prescription.id },
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
      });

      res.json({ success: true, prescription, downloadUrl, safetySummary });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/:id/prescription/pdf",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const prescription = await prisma.prescription.findUnique({
        where: { triageCaseId: id },
        include: {
          triageCase: true,
          patient: {
            select: { id: true, firstName: true, lastName: true, dateOfBirth: true },
          },
          doctor: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              hcpsaNumber: true,
            },
          },
        },
      });

      if (!prescription) {
        return res.status(404).json({ error: "Prescription not found" });
      }
      if (!req.user || !canAccessCase(req.user, prescription.triageCase)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const pdf = await generatePrescriptionPdf({
        id: prescription.id,
        issuedAt: prescription.issuedAt,
        diagnosis: prescription.diagnosis,
        medications: Array.isArray(prescription.medications)
          ? (prescription.medications as {
              name: string;
              dosage: string;
              frequency: string;
              duration: string;
              instructions?: string;
            }[])
          : [],
        doctorNotes: prescription.doctorNotes,
        doctor: {
          firstName: prescription.doctor.firstName,
          lastName: prescription.doctor.lastName,
          hcpsaNumber:
            prescription.hcpsaNumberSnapshot ?? prescription.doctor.hcpsaNumber,
        },
        patient: {
          firstName: prescription.patient.firstName,
          lastName: prescription.patient.lastName,
          dateOfBirth: prescription.patient.dateOfBirth,
        },
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="prescription-${prescription.id.slice(-8)}.pdf"`,
      );
      res.send(pdf);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/:id/emergency-referral",
  requireDoctor,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const {
        referralType,
        provisionalDiagnosis,
        clinicalNotes,
        recommendedFacility,
      } = req.body ?? {};

      if (
        !referralType?.trim() ||
        !provisionalDiagnosis?.trim() ||
        !clinicalNotes?.trim() ||
        !recommendedFacility?.trim()
      ) {
        return res.status(400).json({
          error:
            "Referral type, provisional diagnosis, clinical notes, and recommended facility are required",
        });
      }

      const triageCase = await prisma.triageCase.findUnique({
        where: { id },
        include: triageCaseInclude,
      });
      if (!triageCase) {
        return res.status(404).json({ error: "Triage case not found" });
      }
      if (triageCase.doctorId && triageCase.doctorId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const doctor = await getDoctorProfile(req.user!.id);
      if (!doctor) {
        return res.status(404).json({ error: "Doctor profile not found" });
      }

      const [referral] = await prisma.$transaction([
        prisma.referral.upsert({
          where: { triageCaseId: id },
          update: {
            referralType: referralType.trim(),
            provisionalDiagnosis: provisionalDiagnosis.trim(),
            clinicalNotes: clinicalNotes.trim(),
            recommendedFacility: recommendedFacility.trim(),
            hcpsaNumberSnapshot: doctor.hcpsaNumber,
            doctorNameSnapshot: `${doctor.firstName} ${doctor.lastName}`,
            doctorId: req.user!.id,
          },
          create: {
            triageCaseId: id,
            patientId: triageCase.patientId,
            doctorId: req.user!.id,
            referralType: referralType.trim(),
            provisionalDiagnosis: provisionalDiagnosis.trim(),
            clinicalNotes: clinicalNotes.trim(),
            recommendedFacility: recommendedFacility.trim(),
            hcpsaNumberSnapshot: doctor.hcpsaNumber,
            doctorNameSnapshot: `${doctor.firstName} ${doctor.lastName}`,
          },
        }),
        prisma.triageCase.update({
          where: { id },
          data: {
            doctorId: req.user!.id,
            doctorDiagnosis: provisionalDiagnosis.trim(),
            finalDiagnosis: provisionalDiagnosis.trim(),
            doctorNotes: clinicalNotes.trim(),
            referredTo: recommendedFacility.trim(),
            status: TriageCaseStatus.EMERGENCY_REFERRAL,
            reviewedAt: triageCase.reviewedAt ?? new Date(),
            releasedAt: new Date(),
          },
        }),
      ]);

      const downloadUrl = `/api/triage-review/${id}/referral/pdf`;
      sendToUser(triageCase.patientId, {
        type: "EMERGENCY_REFERRAL_ISSUED",
        data: {
          triageCaseId: id,
          referralId: referral.id,
          doctorName: `Dr. ${doctor.firstName} ${doctor.lastName}`,
          referralType: referral.referralType,
          provisionalDiagnosis: referral.provisionalDiagnosis,
          recommendedFacility: referral.recommendedFacility,
          downloadUrl,
        },
      });

      if (triageCase.patient?.email) {
        await notifyTriageReferred({
          to: triageCase.patient.email,
          patientName: triageCase.patient.firstName,
          referredTo: `${referral.referralType} - ${referral.recommendedFacility}`,
          doctorNotes: referral.clinicalNotes,
        });
      }

      await createAuditLog({
        userId: req.user!.id,
        userRole: req.user!.role,
        action: "CREATE",
        resource: "TriageCaseReview",
        resourceId: id,
        metadata: { actionType: "EMERGENCY_REFERRAL", referralId: referral.id },
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
      });

      res.json({ success: true, referral, downloadUrl });
    } catch (error) {
      next(error);
    }
  },
);

router.get("/:id/referral/pdf", async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const referral = await prisma.referral.findUnique({
      where: { triageCaseId: id },
      include: {
        triageCase: true,
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            phone: true,
          },
        },
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            hcpsaNumber: true,
          },
        },
      },
    });

    if (!referral) {
      return res.status(404).json({ error: "Referral not found" });
    }
    if (!req.user || !canAccessCase(req.user, referral.triageCase)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const pdf = await generateReferralPdf({
      id: referral.id,
      issuedAt: referral.issuedAt,
      referralType: referral.referralType,
      recommendedFacility: referral.recommendedFacility,
      provisionalDiagnosis: referral.provisionalDiagnosis,
      clinicalNotes: referral.clinicalNotes,
      doctor: {
        firstName: referral.doctor.firstName,
        lastName: referral.doctor.lastName,
        hcpsaNumber: referral.hcpsaNumberSnapshot ?? referral.doctor.hcpsaNumber,
      },
      patient: {
        firstName: referral.patient.firstName,
        lastName: referral.patient.lastName,
        dateOfBirth: referral.patient.dateOfBirth,
        phone: referral.patient.phone,
      },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="referral-${referral.id.slice(-8)}.pdf"`,
    );
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

router.get(
  "/profile/hpcsa",
  requireDoctor,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const doctor = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { hcpsaNumber: true, hcpsaVerified: true },
      });

      res.json({
        success: true,
        hcpsa: {
          hcpsaNumber: doctor?.hcpsaNumber ?? null,
          hcpsaVerified: doctor?.hcpsaVerified ?? false,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/profile/hpcsa",
  requireDoctor,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const hcpsaNumber = String(req.body?.hcpsaNumber ?? "").trim();
      if (!hcpsaNumber) {
        return res.status(400).json({ error: "HPCSA number is required" });
      }

      const existing = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { hcpsaNumber: true },
      });

      const updated = await prisma.user.update({
        where: { id: req.user!.id },
        data: {
          hcpsaNumber,
          hcpsaVerified: existing?.hcpsaNumber === hcpsaNumber ? undefined : false,
          hcpsaVerifiedAt: existing?.hcpsaNumber === hcpsaNumber ? undefined : null,
        },
        select: { hcpsaNumber: true, hcpsaVerified: true },
      });

      await createAuditLog({
        userId: req.user!.id,
        userRole: req.user!.role,
        action: "UPDATE",
        resource: "TriageCaseReview",
        metadata: { actionType: "HPCSA_PROFILE_UPDATE" },
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
      });

      res.json({ success: true, hcpsa: updated });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
