import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const whatsAppSaveSchema = z.object({
  workspaceId: z.string().uuid(),
  phoneNumberId: z.string().min(1, "Phone Number ID is required"),
  businessAccountId: z.string().optional(),
  accessToken: z.string().min(1, "Meta Access Token is required"),
  verifyToken: z.string().optional(),
});

const whatsAppTestSchema = z.object({
  workspaceId: z.string().uuid(),
  phoneNumberId: z.string().optional(),
  accessToken: z.string().optional(),
});

const emailSaveSchema = z.object({
  workspaceId: z.string().uuid(),
  provider: z.enum(["resend", "smtp", "sendgrid", "gmail"]),
  fromEmail: z.string().email("A valid sender email is required"),
  fromName: z.string().optional(),
  // Resend
  resendApiKey: z.string().optional(),
  // SMTP
  smtpHost: z.string().optional(),
  smtpPort: z.number().optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
  smtpSecure: z.boolean().optional(),
  // SendGrid
  sendgridApiKey: z.string().optional(),
});

const emailTestSchema = z.object({
  workspaceId: z.string().uuid(),
  testRecipientEmail: z.string().email("A valid test recipient email address is required"),
  customConfig: emailSaveSchema.optional(),
});

const disconnectSchema = z.object({
  workspaceId: z.string().uuid(),
  providerType: z.enum(["whatsapp", "email", "sms", "voice"]),
});

export const getIntegrationsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { getMaskedIntegrationsState } = await import("./integrations.server");
    return getMaskedIntegrationsState(context.supabase, data.workspaceId);
  });


export const saveWhatsAppIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => whatsAppSaveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { testMetaWhatsAppConnection } = await import("./integrations.server");

    // Live test the credentials against Meta Graph API
    const testResult = await testMetaWhatsAppConnection({
      phoneNumberId: data.phoneNumberId,
      accessToken: data.accessToken,
      businessAccountId: data.businessAccountId ?? undefined,
    });

    const status = testResult.ok ? "connected" : "error";
    const details = (testResult.details ?? {}) as Record<string, any>;
    const lastTestError = testResult.error ?? null;

    // Upsert into workspace_integrations table
    const { error: upsertError } = await (context.supabase as any).from("workspace_integrations").upsert(
      {
        workspace_id: data.workspaceId,
        provider_type: "whatsapp",
        provider: "meta_whatsapp",
        config: {
          phoneNumberId: data.phoneNumberId,
          businessAccountId: data.businessAccountId || "",
          accessToken: data.accessToken,
          verifyToken: data.verifyToken || "",
        },
        details,
        status,
        is_active: true,
        last_tested_at: new Date().toISOString(),
        last_test_error: lastTestError,
      },
      { onConflict: "workspace_id,provider_type" },
    );

    if (upsertError) {
      throw new Error(`Failed to save WhatsApp integration: ${upsertError.message}`);
    }

    return {
      success: testResult.ok,
      status,
      details,
      error: lastTestError,
    };
  });

export const testWhatsAppIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => whatsAppTestSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { testMetaWhatsAppConnection, getWorkspaceIntegrationConfig } =
      await import("./integrations.server");

    let phoneNumberId = data.phoneNumberId;
    let accessToken = data.accessToken;

    if (!phoneNumberId || !accessToken) {
      const existing = await getWorkspaceIntegrationConfig(
        context.supabase,
        data.workspaceId,
        "whatsapp",
      );
      const conf = existing?.config as Record<string, any> | undefined;
      if (!conf || !conf["accessToken"] || !conf["phoneNumberId"]) {
        return {
          ok: false,
          error: "No WhatsApp credentials configured to test.",
        };
      }
      phoneNumberId = conf["phoneNumberId"] as string;
      accessToken = conf["accessToken"] as string;
    }

    const testResult = await testMetaWhatsAppConnection({
      phoneNumberId: phoneNumberId!,
      accessToken: accessToken!,
    });

    // Update status in DB
    await (context.supabase as any)
      .from("workspace_integrations")
      .update({
        status: testResult.ok ? "connected" : "error",
        details: (testResult.details ?? {}) as Record<string, any>,
        last_tested_at: new Date().toISOString(),
        last_test_error: testResult.error ?? null,
      })
      .eq("workspace_id", data.workspaceId)
      .eq("provider_type", "whatsapp");

    return testResult;
  });

export const saveEmailIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => emailSaveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const configPayload: Record<string, any> = {
      provider: data.provider,
      fromEmail: data.fromEmail,
      fromName: data.fromName || "",
    };

    if (data.provider === "resend") {
      configPayload["resendApiKey"] = data.resendApiKey;
    } else if (data.provider === "smtp") {
      configPayload["smtpHost"] = data.smtpHost;
      configPayload["smtpPort"] = data.smtpPort || 587;
      configPayload["smtpUser"] = data.smtpUser;
      configPayload["smtpPassword"] = data.smtpPassword;
      configPayload["smtpSecure"] = data.smtpSecure ?? false;
    } else if (data.provider === "sendgrid") {
      configPayload["sendgridApiKey"] = data.sendgridApiKey;
    }

    // Upsert into workspace_integrations table
    const { error: upsertError } = await (context.supabase as any).from("workspace_integrations").upsert(
      {
        workspace_id: data.workspaceId,
        provider_type: "email",
        provider: data.provider,
        config: configPayload,
        details: {
          fromEmail: data.fromEmail,
          fromName: data.fromName || "",
          provider: data.provider,
        },
        status: "connected",
        is_active: true,
        last_tested_at: new Date().toISOString(),
        last_test_error: null,
      },
      { onConflict: "workspace_id,provider_type" },
    );

    if (upsertError) {
      throw new Error(`Failed to save Email integration: ${upsertError.message}`);
    }

    return { success: true };
  });

export const testEmailIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => emailTestSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { testEmailConnection, getWorkspaceIntegrationConfig } =
      await import("./integrations.server");

    let emailConfig: any = data.customConfig;

    if (!emailConfig) {
      const existing = await getWorkspaceIntegrationConfig(
        context.supabase,
        data.workspaceId,
        "email",
      );
      if (!existing || !existing.config) {
        return {
          ok: false,
          error: "No Email configuration found. Please configure your email provider first.",
        };
      }
      emailConfig = existing.config;
    }

    emailConfig.workspaceId = data.workspaceId;

    const testResult = await testEmailConnection({
      config: emailConfig,
      testRecipient: data.testRecipientEmail,
    });

    // Update status in DB
    await (context.supabase as any)
      .from("workspace_integrations")
      .update({
        status: testResult.ok ? "connected" : "error",
        last_tested_at: new Date().toISOString(),
        last_test_error: testResult.error ?? null,
      })
      .eq("workspace_id", data.workspaceId)
      .eq("provider_type", "email");

    return testResult;
  });

export const disconnectIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => disconnectSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("workspace_integrations")
      .delete()
      .eq("workspace_id", data.workspaceId)
      .eq("provider_type", data.providerType);

    if (error) {
      throw new Error(`Failed to disconnect integration: ${error.message}`);
    }

    return { success: true };
  });

const googleOAuthUrlSchema = z.object({
  workspaceId: z.string().uuid().optional(),
});

export const getGoogleOAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => googleOAuthUrlSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    let workspaceId = data?.workspaceId;

    if (!workspaceId) {
      const { data: member } = await context.supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", context.userId)
        .limit(1)
        .maybeSingle();

      if (!member?.workspace_id) {
        throw new Error(
          "No workspace found for your account. Please create or join a workspace first.",
        );
      }
      workspaceId = member.workspace_id;
    } else {
      const { data: member, error: memberError } = await context.supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", context.userId)
        .maybeSingle();

      if (memberError || !member) {
        throw new Error("Unauthorized: You are not a member of this workspace.");
      }
    }

    const { createGoogleAuthUrl } = await import("./google-auth.server");
    const url = await createGoogleAuthUrl({
      workspaceId,
      userId: context.userId,
    });

    return { url };
  });

