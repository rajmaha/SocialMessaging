"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import { formsApi } from "@/lib/api";
import { API_URL } from "@/lib/config";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FieldCondition {
  field_key: string;
  operator: "equals" | "not_equals" | "lt" | "lte" | "gt" | "gte";
  value: string;
}

interface FormField {
  field_label: string;
  field_key: string;
  field_type: string;
  placeholder?: string;
  is_required?: boolean;
  default_value?: string;
  options?: { key: string; value: string }[];
  validation_rules?: Record<string, any>;
  api_endpoint?: string;
  api_value_key?: string;
  api_label_key?: string;
  condition?: FieldCondition | FieldCondition[];
}

interface PublicForm {
  title: string;
  description?: string;
  success_message?: string;
  require_otp?: boolean;
  fields: FormField[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const PATTERNS: Record<string, RegExp> = {
  alpha: /^[a-zA-Z\s\-,._]+$/,
  alphanumeric: /^[a-zA-Z0-9\s]+$/,
  alpha_special: /^[a-zA-Z0-9\s\-,._]+$/,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function evaluateCondition(
  cond: FieldCondition,
  values: Record<string, any>
): boolean {
  const actual = values[cond.field_key];
  if (actual === undefined || actual === null || actual === "") return false;

  const a = String(actual);
  const b = String(cond.value);

  switch (cond.operator) {
    case "equals":
      return a === b;
    case "not_equals":
      return a !== b;
    case "lt":
      return Number(a) < Number(b);
    case "lte":
      return Number(a) <= Number(b);
    case "gt":
      return Number(a) > Number(b);
    case "gte":
      return Number(a) >= Number(b);
    default:
      return true;
  }
}

function isFieldVisible(
  field: FormField,
  values: Record<string, any>
): boolean {
  if (!field.condition) return true;
  const conditions = Array.isArray(field.condition)
    ? field.condition
    : [field.condition];
  return conditions.every((c) => evaluateCondition(c, values));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PublicFormPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [form, setForm] = useState<PublicForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // For OTP email field
  const [submitterEmail, setSubmitterEmail] = useState("");

  // API-fetched options keyed by field_key
  const [apiOptions, setApiOptions] = useState<
    Record<string, { key: string; value: string }[]>
  >({});
  const [apiLoading, setApiLoading] = useState<Record<string, boolean>>({});

  /* ---------- load form ---------- */

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    formsApi
      .getPublicForm(slug)
      .then((res) => {
        const f: PublicForm = res.data;
        setForm(f);

        // set default values
        const defaults: Record<string, any> = {};
        f.fields.forEach((field) => {
          if (field.default_value !== undefined && field.default_value !== null && field.default_value !== "") {
            defaults[field.field_key] = field.default_value;
          } else if (
            field.field_type === "checkbox" ||
            field.field_type === "checkbox_api"
          ) {
            defaults[field.field_key] = [];
          } else {
            defaults[field.field_key] = "";
          }
        });
        setValues(defaults);
      })
      .catch(() => setLoadError("Form not found or unavailable."))
      .finally(() => setLoading(false));
  }, [slug]);

  /* ---------- fetch API options ---------- */

  useEffect(() => {
    if (!form) return;
    form.fields.forEach((field) => {
      if (
        (field.field_type === "dropdown_api" ||
          field.field_type === "checkbox_api") &&
        field.api_endpoint
      ) {
        setApiLoading((prev) => ({ ...prev, [field.field_key]: true }));
        fetch(`${API_URL}${field.api_endpoint}`)
          .then((r) => r.json())
          .then((data) => {
            const items = Array.isArray(data) ? data : data.data ?? data.items ?? [];
            const mapped = items.map((item: any) => ({
              key: String(item[field.api_value_key || "id"]),
              value: String(item[field.api_label_key || "name"]),
            }));
            setApiOptions((prev) => ({ ...prev, [field.field_key]: mapped }));
          })
          .catch(() => {
            setApiOptions((prev) => ({ ...prev, [field.field_key]: [] }));
          })
          .finally(() =>
            setApiLoading((prev) => ({ ...prev, [field.field_key]: false }))
          );
      }
    });
  }, [form]);

  /* ---------- visibility ---------- */

  const visibleFields = useMemo(() => {
    if (!form) return [];
    return form.fields.filter((f) => isFieldVisible(f, values));
  }, [form, values]);

  const visibleKeys = useMemo(
    () => new Set(visibleFields.map((f) => f.field_key)),
    [visibleFields]
  );

  /* ---------- set value ---------- */

  const setValue = useCallback(
    (key: string, val: any) => {
      setValues((prev) => ({ ...prev, [key]: val }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    []
  );

  /* ---------- validation ---------- */

  const validate = useCallback((): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!form) return errs;

    // Validate OTP email field if required
    if (form.require_otp) {
      if (!submitterEmail.trim()) {
        errs["__submitter_email"] = "Email address is required";
      } else if (!EMAIL_RE.test(submitterEmail.trim())) {
        errs["__submitter_email"] = "Invalid email address";
      }
    }

    visibleFields.forEach((field) => {
      const val = values[field.field_key];
      const rules = field.validation_rules || {};
      const strVal = typeof val === "string" ? val.trim() : "";
      const isArr = Array.isArray(val);

      // required
      if (field.is_required) {
        if (isArr && val.length === 0) {
          errs[field.field_key] = `${field.field_label} is required`;
          return;
        }
        if (!isArr && strVal === "") {
          errs[field.field_key] = `${field.field_label} is required`;
          return;
        }
      }

      // skip further validation if empty & not required
      if (!isArr && strVal === "") return;
      if (isArr && val.length === 0) return;

      switch (field.field_type) {
        case "text": {
          if (rules.min_length && strVal.length < Number(rules.min_length)) {
            errs[field.field_key] = `Minimum ${rules.min_length} characters`;
          } else if (
            rules.max_length &&
            strVal.length > Number(rules.max_length)
          ) {
            errs[field.field_key] = `Maximum ${rules.max_length} characters`;
          } else if (rules.pattern && PATTERNS[rules.pattern]) {
            if (!PATTERNS[rules.pattern].test(strVal)) {
              errs[field.field_key] = `Invalid characters in ${field.field_label}`;
            }
          }
          break;
        }
        case "number": {
          const num = Number(strVal);
          if (isNaN(num)) {
            errs[field.field_key] = "Must be a number";
          } else if (rules.min !== undefined && num < Number(rules.min)) {
            errs[field.field_key] = `Minimum value is ${rules.min}`;
          } else if (rules.max !== undefined && num > Number(rules.max)) {
            errs[field.field_key] = `Maximum value is ${rules.max}`;
          }
          break;
        }
        case "email": {
          if (!EMAIL_RE.test(strVal)) {
            errs[field.field_key] = "Invalid email address";
          }
          break;
        }
        case "url": {
          try {
            new URL(strVal);
          } catch {
            errs[field.field_key] = "Invalid URL";
          }
          break;
        }
        case "date": {
          if (rules.min && strVal < rules.min) {
            errs[field.field_key] = `Date must be on or after ${rules.min}`;
          } else if (rules.max && strVal > rules.max) {
            errs[field.field_key] = `Date must be on or before ${rules.max}`;
          }
          break;
        }
        case "time": {
          if (rules.min && strVal < rules.min) {
            errs[field.field_key] = `Time must be on or after ${rules.min}`;
          } else if (rules.max && strVal > rules.max) {
            errs[field.field_key] = `Time must be on or before ${rules.max}`;
          }
          break;
        }
        case "checkbox":
        case "checkbox_api": {
          if (rules.min !== undefined && val.length < Number(rules.min)) {
            errs[field.field_key] = `Select at least ${rules.min}`;
          } else if (rules.max !== undefined && val.length > Number(rules.max)) {
            errs[field.field_key] = `Select at most ${rules.max}`;
          }
          break;
        }
      }
    });

    return errs;
  }, [form, visibleFields, values, submitterEmail]);

  /* ---------- submit ---------- */

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError("");

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      setGeneralError("Please fix the errors below before submitting.");
      return;
    }

    // Build submission data from visible fields only
    const data: Record<string, any> = {};
    visibleFields.forEach((f) => {
      data[f.field_key] = values[f.field_key];
    });

    setSubmitting(true);
    try {
      await formsApi.submitForm(slug, {
        data,
        submitter_email: submitterEmail || undefined,
      });
      setSubmitted(true);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail || "Something went wrong. Please try again.";
      setGeneralError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- render helpers ---------- */

  const inputClasses = (key: string) =>
    `w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition ${
      errors[key] ? "border-red-400" : "border-gray-300"
    }`;

  const renderLabel = (field: FormField) => (
    <label
      htmlFor={field.field_key}
      className="block text-sm font-medium text-gray-700 mb-1"
    >
      {field.field_label}
      {field.is_required && <span className="text-red-500 ml-1">*</span>}
    </label>
  );

  const renderError = (key: string) =>
    errors[key] ? (
      <p className="text-red-500 text-sm mt-1">{errors[key]}</p>
    ) : null;

  const renderField = (field: FormField) => {
    const key = field.field_key;
    const val = values[key] ?? "";
    const rules = field.validation_rules || {};

    switch (field.field_type) {
      /* ---- text ---- */
      case "text":
        return (
          <input
            id={key}
            type="text"
            className={inputClasses(key)}
            placeholder={field.placeholder || ""}
            value={val}
            onChange={(e) => setValue(key, e.target.value)}
            minLength={rules.min_length ? Number(rules.min_length) : undefined}
            maxLength={rules.max_length ? Number(rules.max_length) : undefined}
          />
        );

      /* ---- number ---- */
      case "number":
        return (
          <input
            id={key}
            type="number"
            className={inputClasses(key)}
            placeholder={field.placeholder || ""}
            value={val}
            onChange={(e) => setValue(key, e.target.value)}
            min={rules.min}
            max={rules.max}
          />
        );

      /* ---- textarea ---- */
      case "textarea":
        return (
          <textarea
            id={key}
            className={inputClasses(key)}
            placeholder={field.placeholder || ""}
            rows={4}
            value={val}
            onChange={(e) => setValue(key, e.target.value)}
          />
        );

      /* ---- email ---- */
      case "email":
        return (
          <input
            id={key}
            type="email"
            className={inputClasses(key)}
            placeholder={field.placeholder || ""}
            value={val}
            onChange={(e) => setValue(key, e.target.value)}
          />
        );

      /* ---- url ---- */
      case "url":
        return (
          <input
            id={key}
            type="url"
            className={inputClasses(key)}
            placeholder={field.placeholder || ""}
            value={val}
            onChange={(e) => setValue(key, e.target.value)}
          />
        );

      /* ---- date ---- */
      case "date":
        return (
          <input
            id={key}
            type="date"
            className={inputClasses(key)}
            value={val}
            onChange={(e) => setValue(key, e.target.value)}
            min={rules.min}
            max={rules.max}
          />
        );

      /* ---- time ---- */
      case "time":
        return (
          <input
            id={key}
            type="time"
            className={inputClasses(key)}
            value={val}
            onChange={(e) => setValue(key, e.target.value)}
            min={rules.min}
            max={rules.max}
          />
        );

      /* ---- dropdown ---- */
      case "dropdown":
        return (
          <select
            id={key}
            className={inputClasses(key)}
            value={val}
            onChange={(e) => setValue(key, e.target.value)}
          >
            <option value="">— Select —</option>
            {(field.options || []).map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.value}
              </option>
            ))}
          </select>
        );

      /* ---- dropdown_api ---- */
      case "dropdown_api": {
        const opts = apiOptions[key] || [];
        const isLoading = apiLoading[key];
        return (
          <select
            id={key}
            className={inputClasses(key)}
            value={val}
            onChange={(e) => setValue(key, e.target.value)}
            disabled={isLoading}
          >
            {isLoading ? (
              <option>Loading...</option>
            ) : (
              <>
                <option value="">— Select —</option>
                {opts.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.value}
                  </option>
                ))}
              </>
            )}
          </select>
        );
      }

      /* ---- checkbox ---- */
      case "checkbox":
        return (
          <div className="space-y-2">
            {(field.options || []).map((opt) => {
              const checked = Array.isArray(val) && val.includes(opt.key);
              return (
                <label
                  key={opt.key}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={checked}
                    onChange={() => {
                      const arr = Array.isArray(val) ? [...val] : [];
                      if (checked) {
                        setValue(
                          key,
                          arr.filter((v) => v !== opt.key)
                        );
                      } else {
                        setValue(key, [...arr, opt.key]);
                      }
                    }}
                  />
                  <span className="text-sm text-gray-700">{opt.value}</span>
                </label>
              );
            })}
          </div>
        );

      /* ---- checkbox_api ---- */
      case "checkbox_api": {
        const opts = apiOptions[key] || [];
        const isLoading = apiLoading[key];
        if (isLoading)
          return <p className="text-sm text-gray-400">Loading...</p>;
        return (
          <div className="space-y-2">
            {opts.map((opt) => {
              const checked = Array.isArray(val) && val.includes(opt.key);
              return (
                <label
                  key={opt.key}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={checked}
                    onChange={() => {
                      const arr = Array.isArray(val) ? [...val] : [];
                      if (checked) {
                        setValue(
                          key,
                          arr.filter((v) => v !== opt.key)
                        );
                      } else {
                        setValue(key, [...arr, opt.key]);
                      }
                    }}
                  />
                  <span className="text-sm text-gray-700">{opt.value}</span>
                </label>
              );
            })}
          </div>
        );
      }

      /* ---- yes_no ---- */
      case "yes_no":
        return (
          <div className="flex gap-4">
            {[
              { label: "Yes", value: "1" },
              { label: "No", value: "0" },
            ].map((opt) => (
              <label
                key={opt.value}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition ${
                  val === opt.value
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-gray-300 hover:border-gray-400"
                }`}
              >
                <input
                  type="radio"
                  name={key}
                  className="sr-only"
                  checked={val === opt.value}
                  onChange={() => setValue(key, opt.value)}
                />
                <span className="text-sm font-medium">{opt.label}</span>
              </label>
            ))}
          </div>
        );

      /* ---- true_false ---- */
      case "true_false":
        return (
          <div className="flex gap-4">
            {[
              { label: "True", value: "1" },
              { label: "False", value: "0" },
            ].map((opt) => (
              <label
                key={opt.value}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition ${
                  val === opt.value
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-gray-300 hover:border-gray-400"
                }`}
              >
                <input
                  type="radio"
                  name={key}
                  className="sr-only"
                  checked={val === opt.value}
                  onChange={() => setValue(key, opt.value)}
                />
                <span className="text-sm font-medium">{opt.label}</span>
              </label>
            ))}
          </div>
        );

      default:
        return (
          <input
            id={key}
            type="text"
            className={inputClasses(key)}
            placeholder={field.placeholder || ""}
            value={val}
            onChange={(e) => setValue(key, e.target.value)}
          />
        );
    }
  };

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (loadError || !form) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow p-8 max-w-md text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-400 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-gray-600">{loadError || "Form not found."}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="mx-auto flex items-center justify-center h-14 w-14 rounded-full bg-green-100 mb-4">
            <svg
              className="h-8 w-8 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <p className="text-lg text-gray-700">
            {form.success_message || "Thank you! Your response has been submitted."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg p-6 sm:p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            {form.title}
          </h1>
          {form.description && (
            <p className="text-gray-500 mb-6">{form.description}</p>
          )}

          {generalError && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {generalError}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* OTP email field (auto-added when require_otp) */}
            {/* TODO: Implement OTP verification flow */}
            {form.require_otp && (
              <div>
                <label
                  htmlFor="__submitter_email"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Email Address
                  <span className="text-red-500 ml-1">*</span>
                </label>
                <input
                  id="__submitter_email"
                  type="email"
                  className={inputClasses("__submitter_email")}
                  placeholder="you@example.com"
                  value={submitterEmail}
                  onChange={(e) => {
                    setSubmitterEmail(e.target.value);
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next["__submitter_email"];
                      return next;
                    });
                  }}
                />
                {errors["__submitter_email"] && (
                  <p className="text-red-500 text-sm mt-1">
                    {errors["__submitter_email"]}
                  </p>
                )}
              </div>
            )}

            {/* Dynamic fields */}
            {visibleFields.map((field) => (
              <div key={field.field_key}>
                {renderLabel(field)}
                {renderField(field)}
                {renderError(field.field_key)}
              </div>
            ))}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Submitting..." : "Submit"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
