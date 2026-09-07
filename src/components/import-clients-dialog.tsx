import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import React, { useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { importClientsServerFn, type ClientImportItem } from "@/lib/clients.functions";
import {
  CLIENT_SOURCES,
  DEAL_STATUSES,
  STATUS_LABELS,
  type DealStatus,
} from "@/lib/crm";

type TargetFieldKey =
  | "name"
  | "company"
  | "email"
  | "phone"
  | "whatsapp"
  | "website"
  | "source"
  | "status"
  | "deal_value"
  | "notes";

interface TargetFieldDef {
  key: TargetFieldKey;
  label: string;
  required?: boolean;
  synonyms: string[];
}

const TARGET_FIELDS: TargetFieldDef[] = [
  {
    key: "name",
    label: "Full Name",
    required: true,
    synonyms: ["name", "full name", "fullname", "client name", "contact name", "contact", "lead name", "customer name", "client", "person"],
  },
  {
    key: "email",
    label: "Email Address",
    synonyms: ["email", "email address", "e-mail", "mail", "contact email"],
  },
  {
    key: "phone",
    label: "Phone Number",
    synonyms: ["phone", "phone number", "mobile", "telephone", "tel", "cell", "contact number"],
  },
  {
    key: "company",
    label: "Company",
    synonyms: ["company", "company name", "organization", "organisation", "business", "corp", "account"],
  },
  {
    key: "status",
    label: "Deal Status",
    synonyms: ["status", "deal status", "stage", "pipeline stage", "lead status"],
  },
  {
    key: "source",
    label: "Source",
    synonyms: ["source", "lead source", "channel", "referral source", "acquisition"],
  },
  {
    key: "website",
    label: "Website",
    synonyms: ["website", "web", "url", "site"],
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    synonyms: ["whatsapp", "wa", "whatsapp number"],
  },
  {
    key: "deal_value",
    label: "Deal Value ($)",
    synonyms: ["deal value", "value", "amount", "deal amount", "revenue", "price"],
  },
  {
    key: "notes",
    label: "Notes",
    synonyms: ["notes", "note", "comment", "comments", "description"],
  },
];

type ColumnMapping = Record<TargetFieldKey, string>; // maps targetField -> fileColumnName or ""

type RowValidationStatus = "valid" | "duplicate" | "invalid";

interface ParsedRowResult {
  raw: Record<string, unknown>;
  client: ClientImportItem;
  status: RowValidationStatus;
  reason?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeStatus(val: unknown): DealStatus {
  if (typeof val !== "string" || !val.trim()) return "lead";
  const clean = val.trim().toLowerCase().replace(/[\s_-]+/g, "_");
  if (DEAL_STATUSES.includes(clean as DealStatus)) {
    return clean as DealStatus;
  }
  // Try matching against STATUS_LABELS
  for (const [key, label] of Object.entries(STATUS_LABELS)) {
    if (label.toLowerCase() === val.trim().toLowerCase()) {
      return key as DealStatus;
    }
  }
  return "lead";
}

function normalizeSource(val: unknown): string | null {
  if (typeof val !== "string" || !val.trim()) return null;
  const trimmed = val.trim();
  const matched = CLIENT_SOURCES.find(
    (s) => s.toLowerCase() === trimmed.toLowerCase(),
  );
  return matched || trimmed;
}

export function ImportClientsDialog({
  open,
  onOpenChange,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | null;
}) {
  const queryClient = useQueryClient();
  const importFn = useServerFn(importClientsServerFn);
  const fileInputId = useId();

  // Dialog Steps: 1 = upload, 2 = column mapping, 3 = preview & confirm
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [rawDataRows, setRawDataRows] = useState<Array<Record<string, unknown>>>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>(() => ({
    name: "",
    company: "",
    email: "",
    phone: "",
    whatsapp: "",
    website: "",
    source: "",
    status: "",
    deal_value: "",
    notes: "",
  }));

  const [previewTab, setPreviewTab] = useState<"all" | "valid" | "duplicate" | "invalid">("all");
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resetState = () => {
    setStep(1);
    setFile(null);
    setDetectedColumns([]);
    setRawDataRows([]);
    setColumnMapping({
      name: "",
      company: "",
      email: "",
      phone: "",
      whatsapp: "",
      website: "",
      source: "",
      status: "",
      deal_value: "",
      notes: "",
    });
    setPreviewTab("all");
    setIsProcessingFile(false);
    setIsImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      resetState();
    }
    onOpenChange(isOpen);
  };

  // Step 1: Handle File Selection & Parsing
  const handleFile = async (selectedFile: File) => {
    const ext = selectedFile.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast.error("Invalid file format. Please upload a .xlsx or .csv file.");
      return;
    }

    setIsProcessingFile(true);
    setFile(selectedFile);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error("Spreadsheet contains no sheets.");
      }
      const worksheet = workbook.Sheets[firstSheetName];
      if (!worksheet) {
        throw new Error("Could not find worksheet in the uploaded file.");
      }
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: "",
        raw: false,
      });

      if (rows.length === 0) {
        toast.error("The uploaded spreadsheet is empty.");
        setIsProcessingFile(false);
        return;
      }

      // Extract unique column names
      const cols = Array.from(
        new Set(
          rows.flatMap((r) => Object.keys(r)).filter((k) => k && !k.startsWith("__EMPTY")),
        ),
      );

      setDetectedColumns(cols);
      setRawDataRows(rows);

      // Automatic Column Detection
      const initialMapping: ColumnMapping = {
        name: "",
        company: "",
        email: "",
        phone: "",
        whatsapp: "",
        website: "",
        source: "",
        status: "",
        deal_value: "",
        notes: "",
      };

      for (const field of TARGET_FIELDS) {
        const found = cols.find((col) => {
          const lower = col.trim().toLowerCase();
          return field.synonyms.some((syn) => lower === syn || lower.includes(syn));
        });
        if (found) {
          initialMapping[field.key] = found;
        }
      }

      setColumnMapping(initialMapping);
      setStep(2);
    } catch (err) {
      console.error("[IMPORT] File parsing failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to parse spreadsheet file.");
    } finally {
      setIsProcessingFile(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFile(e.dataTransfer.files[0]!);
    }
  };

  // Step 2 -> 3: Validation and Duplicate Detection
  const [existingClientsData, setExistingClientsData] = useState<{
    emails: Set<string>;
    phones: Set<string>;
  }>({ emails: new Set(), phones: new Set() });

  const proceedToPreview = async () => {
    if (!columnMapping.name) {
      toast.error("Please map the 'Full Name' column to continue.");
      return;
    }

    if (!workspaceId) {
      toast.error("Active workspace not identified.");
      return;
    }

    setIsProcessingFile(true);
    try {
      // Query existing CRM clients for duplicate check
      const { data: existing, error } = await supabase
        .from("clients")
        .select("email, phone")
        .eq("workspace_id", workspaceId);

      if (error) throw error;

      const emails = new Set<string>();
      const phones = new Set<string>();

      for (const item of existing || []) {
        if (item.email) emails.add(item.email.trim().toLowerCase());
        if (item.phone) {
          const cleaned = item.phone.replace(/[^0-9+]/g, "");
          if (cleaned) phones.add(cleaned);
        }
      }

      setExistingClientsData({ emails, phones });
      setStep(3);
    } catch (err) {
      console.error("[IMPORT] Failed to fetch existing clients for validation:", err);
      toast.error("Failed to verify existing CRM records. Please try again.");
    } finally {
      setIsProcessingFile(false);
    }
  };

  // Process rows with validation and duplicate checks
  const parsedRows: ParsedRowResult[] = useMemo(() => {
    if (step !== 3 || rawDataRows.length === 0) return [];

    const seenEmailsInFile = new Set<string>();
    const seenPhonesInFile = new Set<string>();
    const results: ParsedRowResult[] = [];

    for (let i = 0; i < rawDataRows.length; i++) {
      const row = rawDataRows[i]!;
      const rawName = String(row[columnMapping.name] || "").trim();
      const rawEmail = columnMapping.email ? String(row[columnMapping.email] || "").trim() : "";
      const rawPhone = columnMapping.phone ? String(row[columnMapping.phone] || "").trim() : "";
      const rawCompany = columnMapping.company ? String(row[columnMapping.company] || "").trim() : "";
      const rawWhatsapp = columnMapping.whatsapp ? String(row[columnMapping.whatsapp] || "").trim() : "";
      const rawWebsite = columnMapping.website ? String(row[columnMapping.website] || "").trim() : "";
      const rawSource = columnMapping.source ? String(row[columnMapping.source] || "").trim() : "";
      const rawStatus = columnMapping.status ? row[columnMapping.status] : "";
      const rawDealValue = columnMapping.deal_value ? Number(row[columnMapping.deal_value]) : 0;
      const rawNotes = columnMapping.notes ? String(row[columnMapping.notes] || "").trim() : "";

      const clientItem: ClientImportItem = {
        name: rawName,
        company: rawCompany || null,
        email: rawEmail || null,
        phone: rawPhone || null,
        whatsapp: rawWhatsapp || null,
        website: rawWebsite || null,
        source: normalizeSource(rawSource),
        status: normalizeStatus(rawStatus),
        deal_value: isNaN(rawDealValue) || rawDealValue < 0 ? 0 : rawDealValue,
        notes: rawNotes || null,
        tags: [],
      };

      // 1. Validate required name
      if (!rawName) {
        results.push({
          raw: row,
          client: clientItem,
          status: "invalid",
          reason: "Full name is required",
        });
        continue;
      }

      // 2. Validate email format if present
      if (rawEmail && !EMAIL_REGEX.test(rawEmail)) {
        results.push({
          raw: row,
          client: clientItem,
          status: "invalid",
          reason: `Invalid email format (${rawEmail})`,
        });
        continue;
      }

      const emailLower = rawEmail ? rawEmail.toLowerCase() : null;
      const phoneClean = rawPhone ? rawPhone.replace(/[^0-9+]/g, "") : null;

      // 3. Duplicate checks
      let duplicateReason: string | undefined;

      if (emailLower) {
        if (existingClientsData.emails.has(emailLower)) {
          duplicateReason = `Email already exists in CRM (${emailLower})`;
        } else if (seenEmailsInFile.has(emailLower)) {
          duplicateReason = `Duplicate email in spreadsheet (${emailLower})`;
        }
      }

      if (!duplicateReason && phoneClean) {
        if (existingClientsData.phones.has(phoneClean)) {
          duplicateReason = `Phone already exists in CRM (${rawPhone})`;
        } else if (seenPhonesInFile.has(phoneClean)) {
          duplicateReason = `Duplicate phone in spreadsheet (${rawPhone})`;
        }
      }

      if (duplicateReason) {
        results.push({
          raw: row,
          client: clientItem,
          status: "duplicate",
          reason: duplicateReason,
        });
        continue;
      }

      // Mark as seen in this file
      if (emailLower) seenEmailsInFile.add(emailLower);
      if (phoneClean) seenPhonesInFile.add(phoneClean);

      results.push({
        raw: row,
        client: clientItem,
        status: "valid",
      });
    }

    return results;
  }, [step, rawDataRows, columnMapping, existingClientsData]);

  // Metric counts
  const counts = useMemo(() => {
    let valid = 0;
    let duplicate = 0;
    let invalid = 0;
    for (const r of parsedRows) {
      if (r.status === "valid") valid++;
      else if (r.status === "duplicate") duplicate++;
      else if (r.status === "invalid") invalid++;
    }
    return {
      total: parsedRows.length,
      valid,
      duplicate,
      invalid,
    };
  }, [parsedRows]);

  const filteredRows = useMemo(() => {
    if (previewTab === "all") return parsedRows;
    return parsedRows.filter((r) => r.status === previewTab);
  }, [parsedRows, previewTab]);

  // Execute Import
  const handleExecuteImport = async () => {
    if (!workspaceId) {
      toast.error("No active workspace found.");
      return;
    }

    const validClients = parsedRows
      .filter((r) => r.status === "valid")
      .map((r) => r.client);

    if (validClients.length === 0) {
      toast.error("There are no valid clients to import.");
      return;
    }

    setIsImporting(true);

    try {
      const result = await importFn({
        data: {
          workspaceId,
          clients: validClients,
        },
      });

      void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });

      toast.success("Client import completed!", {
        description: `Imported ${result.imported}, Skipped ${result.skippedDuplicates + counts.duplicate} duplicates, Failed ${result.failed + counts.invalid}`,
      });

      handleOpenChange(false);
    } catch (err) {
      console.error("[IMPORT] Execution failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to complete client import.");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] sm:max-w-4xl flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl">Import Clients</DialogTitle>
              <DialogDescription className="mt-1">
                {step === 1 && "Upload a .xlsx or .csv spreadsheet to import your clients."}
                {step === 2 && "Verify and adjust how columns in your spreadsheet match CRM fields."}
                {step === 3 && "Review validation and duplicate results before confirming your import."}
              </DialogDescription>
            </div>
            {/* Step Indicators */}
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <span
                className={`px-2.5 py-1 rounded-full ${
                  step === 1 ? "bg-primary text-primary-foreground font-semibold" : "bg-muted text-muted-foreground"
                }`}
              >
                1. Upload
              </span>
              <span className="text-muted-foreground">→</span>
              <span
                className={`px-2.5 py-1 rounded-full ${
                  step === 2 ? "bg-primary text-primary-foreground font-semibold" : "bg-muted text-muted-foreground"
                }`}
              >
                2. Map
              </span>
              <span className="text-muted-foreground">→</span>
              <span
                className={`px-2.5 py-1 rounded-full ${
                  step === 3 ? "bg-primary text-primary-foreground font-semibold" : "bg-muted text-muted-foreground"
                }`}
              >
                3. Preview
              </span>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6">
          {/* STEP 1: FILE UPLOAD */}
          {step === 1 && (
            <div className="space-y-6">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="border-2 border-dashed rounded-xl p-8 text-center flex flex-col items-center justify-center gap-4 hover:border-primary/60 transition-colors bg-muted/20 cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <Upload className="size-7" />
                </div>
                <div>
                  <p className="font-medium text-base">Drag & drop your client spreadsheet here</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Supports Microsoft Excel (.xlsx, .xls) and CSV (.csv) files up to 10MB
                  </p>
                </div>
                <input
                  id={fileInputId}
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isProcessingFile}
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  {isProcessingFile ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" /> Reading file...
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="mr-2 size-4" /> Browse file
                    </>
                  )}
                </Button>
              </div>

              <div className="bg-muted/40 rounded-lg p-4 text-xs space-y-2 border">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-primary" /> Supported column headers
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  The importer automatically matches common column names including{" "}
                  <strong className="text-foreground">Full Name</strong> (required),{" "}
                  <strong className="text-foreground">Email</strong>,{" "}
                  <strong className="text-foreground">Phone</strong>,{" "}
                  <strong className="text-foreground">Company</strong>,{" "}
                  <strong className="text-foreground">Deal Status</strong>, and{" "}
                  <strong className="text-foreground">Source</strong>. You can customize the mapping in the next step.
                </p>
              </div>
            </div>
          )}

          {/* STEP 2: COLUMN MAPPING */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between bg-muted/40 p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="size-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">{file?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {rawDataRows.length} rows detected · {detectedColumns.length} columns available
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                  Change file
                </Button>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-12 gap-3 text-xs font-semibold text-muted-foreground px-1">
                  <span className="col-span-5">CRM Target Field</span>
                  <span className="col-span-7">Spreadsheet Column</span>
                </div>

                <div className="divide-y border rounded-lg overflow-hidden bg-card">
                  {TARGET_FIELDS.map((field) => {
                    const selectedCol = columnMapping[field.key];
                    // Sample value from first row that has a non-empty value for this column
                    const sampleValue = selectedCol
                      ? String(
                          rawDataRows.find((r) => r[selectedCol] !== undefined && r[selectedCol] !== "")?.[
                            selectedCol
                          ] || "",
                        ).slice(0, 40)
                      : "";

                    return (
                      <div
                        key={field.key}
                        className="grid grid-cols-12 gap-3 p-3 items-center hover:bg-muted/30 transition-colors"
                      >
                        <div className="col-span-5">
                          <Label className="text-sm font-medium flex items-center gap-1">
                            {field.label}
                            {field.required && <span className="text-destructive">*</span>}
                          </Label>
                          {field.required && !selectedCol && (
                            <span className="text-[11px] text-destructive flex items-center gap-1 mt-0.5">
                              <AlertCircle className="size-3" /> Required for import
                            </span>
                          )}
                        </div>

                        <div className="col-span-7 space-y-1">
                          <Select
                            value={selectedCol || "__ignore__"}
                            onValueChange={(val) => {
                              setColumnMapping((prev) => ({
                                ...prev,
                                [field.key]: val === "__ignore__" ? "" : val,
                              }));
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="-- Select column --" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__ignore__">
                                <span className="text-muted-foreground italic">-- Do not import --</span>
                              </SelectItem>
                              {detectedColumns.map((col) => (
                                <SelectItem key={col} value={col}>
                                  {col}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {sampleValue && (
                            <p className="text-[11px] text-muted-foreground truncate pl-1">
                              Sample: <span className="font-mono text-foreground/80">{sampleValue}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW & DUPLICATES */}
          {step === 3 && (
            <div className="space-y-5">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="bg-card">
                  <CardContent className="p-3.5">
                    <p className="text-xs text-muted-foreground">Total Rows</p>
                    <p className="text-2xl font-bold mt-1">{counts.total}</p>
                  </CardContent>
                </Card>
                <Card className="border-emerald-500/30 bg-emerald-50/20 dark:bg-emerald-950/20">
                  <CardContent className="p-3.5">
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                      <CheckCircle2 className="size-3.5" /> Valid to Import
                    </p>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                      {counts.valid}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-amber-500/30 bg-amber-50/20 dark:bg-amber-950/20">
                  <CardContent className="p-3.5">
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                      <Copy className="size-3.5" /> Duplicates (Skipped)
                    </p>
                    <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                      {counts.duplicate}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-destructive/30 bg-destructive/10">
                  <CardContent className="p-3.5">
                    <p className="text-xs text-destructive font-medium flex items-center gap-1">
                      <AlertCircle className="size-3.5" /> Invalid (Skipped)
                    </p>
                    <p className="text-2xl font-bold text-destructive mt-1">
                      {counts.invalid}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Tabs and Filter */}
              <Tabs
                value={previewTab}
                onValueChange={(val) => setPreviewTab(val as typeof previewTab)}
                className="space-y-3"
              >
                <div className="flex items-center justify-between">
                  <TabsList className="h-9">
                    <TabsTrigger value="all" className="text-xs">
                      All ({counts.total})
                    </TabsTrigger>
                    <TabsTrigger value="valid" className="text-xs">
                      Valid ({counts.valid})
                    </TabsTrigger>
                    <TabsTrigger value="duplicate" className="text-xs">
                      Duplicates ({counts.duplicate})
                    </TabsTrigger>
                    <TabsTrigger value="invalid" className="text-xs">
                      Invalid ({counts.invalid})
                    </TabsTrigger>
                  </TabsList>
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    Showing {filteredRows.length} rows
                  </span>
                </div>

                {/* Table View */}
                <div className="border rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur">
                      <TableRow>
                        <TableHead className="w-28">Status</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                            No rows match this filter.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredRows.map((row, idx) => (
                          <TableRow key={idx} className="hover:bg-muted/30">
                            <TableCell>
                              {row.status === "valid" && (
                                <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0">
                                  Valid
                                </Badge>
                              )}
                              {row.status === "duplicate" && (
                                <div className="space-y-1">
                                  <Badge variant="secondary" className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-0">
                                    Duplicate
                                  </Badge>
                                  <p className="text-[10px] text-amber-600 dark:text-amber-400 truncate max-w-[140px]" title={row.reason}>
                                    {row.reason}
                                  </p>
                                </div>
                              )}
                              {row.status === "invalid" && (
                                <div className="space-y-1">
                                  <Badge variant="destructive" className="border-0">
                                    Invalid
                                  </Badge>
                                  <p className="text-[10px] text-destructive truncate max-w-[140px]" title={row.reason}>
                                    {row.reason}
                                  </p>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="font-medium text-sm">
                              {row.client.name || <span className="text-muted-foreground italic">(missing)</span>}
                            </TableCell>
                            <TableCell className="text-sm">
                              {row.client.email || <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-sm">
                              {row.client.phone || <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-sm">
                              {row.client.company || <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-sm capitalize">
                              {STATUS_LABELS[row.client.status] || row.client.status}
                            </TableCell>
                            <TableCell className="text-sm">
                              {row.client.source || <span className="text-muted-foreground">—</span>}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </Tabs>
            </div>
          )}
        </div>

        {/* Dialog Footer Actions */}
        <DialogFooter className="p-4 border-t bg-muted/20 flex items-center justify-between sm:justify-between">
          <div>
            {step === 2 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep(1)}
              >
                <ArrowLeft className="mr-1.5 size-4" /> Back to Upload
              </Button>
            )}
            {step === 3 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isImporting}
                onClick={() => setStep(2)}
              >
                <ArrowLeft className="mr-1.5 size-4" /> Adjust Mapping
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isImporting}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>

            {step === 2 && (
              <Button
                type="button"
                size="sm"
                disabled={isProcessingFile || !columnMapping.name}
                onClick={proceedToPreview}
              >
                {isProcessingFile ? (
                  <>
                    <Loader2 className="mr-1.5 size-4 animate-spin" /> Verifying...
                  </>
                ) : (
                  <>
                    Preview & Validate <ArrowRight className="ml-1.5 size-4" />
                  </>
                )}
              </Button>
            )}

            {step === 3 && (
              <Button
                type="button"
                size="sm"
                disabled={isImporting || counts.valid === 0}
                onClick={handleExecuteImport}
              >
                {isImporting ? (
                  <>
                    <Loader2 className="mr-1.5 size-4 animate-spin" /> Importing {counts.valid} clients...
                  </>
                ) : (
                  <>
                    <Upload className="mr-1.5 size-4" /> Import {counts.valid} Client{counts.valid === 1 ? "" : "s"}
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
