import type { ServiceReportType, WorkOrder } from "./api";

const DATABASE_NAME = "agileworks-field-offline";
const DATABASE_VERSION = 2;
const WORK_ORDERS_STORE = "workOrders";
const REPORTS_STORE = "queuedReports";
const REPORT_TYPES_STORE = "reportTypes";
export const WORK_ORDER_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const MAX_OFFLINE_REPORT_BYTES = 25 * 1024 * 1024;
const MAX_QUEUED_REPORT_BYTES_PER_USER = 50 * 1024 * 1024;

interface CachedWorkOrder {
  cacheKey: string;
  userId: string;
  workOrder: WorkOrder;
  savedAt: number;
}

export interface QueuedServiceReport {
  idempotencyKey: string;
  userId: string;
  customerId: string;
  siteId: string;
  workOrderId: string;
  reportTypeCode: string;
  file: Blob;
  fileName: string;
  fileType: string;
  queuedAt: number;
  status: "PENDING" | "NEEDS_ATTENTION";
  errorMessage?: string;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Offline storage is unavailable in this browser."));

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(WORK_ORDERS_STORE)) {
        const store = database.createObjectStore(WORK_ORDERS_STORE, { keyPath: "cacheKey" });
        store.createIndex("userId", "userId", { unique: false });
      }
      if (!database.objectStoreNames.contains(REPORTS_STORE)) {
        const store = database.createObjectStore(REPORTS_STORE, { keyPath: "idempotencyKey" });
        store.createIndex("userId", "userId", { unique: false });
      }
      if (!database.objectStoreNames.contains(REPORT_TYPES_STORE)) {
        database.createObjectStore(REPORT_TYPES_STORE, { keyPath: "userId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open offline storage."));
  });
}

function cacheKey(userId: string, workOrderId: string): string {
  return `${userId}:${workOrderId}`;
}

export async function saveAssignedWorkOrders(userId: string, workOrders: WorkOrder[]): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(WORK_ORDERS_STORE, "readwrite");
    const store = transaction.objectStore(WORK_ORDERS_STORE);
    const keepIds = new Set(workOrders.map((workOrder) => workOrder.id));
    const cursorRequest = store.index("userId").openCursor(IDBKeyRange.only(userId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        const cached = cursor.value as CachedWorkOrder;
        if (!keepIds.has(cached.workOrder.id)) cursor.delete();
        cursor.continue();
        return;
      }
      const savedAt = Date.now();
      for (const workOrder of workOrders) {
        store.put({ cacheKey: cacheKey(userId, workOrder.id), userId, workOrder, savedAt } satisfies CachedWorkOrder);
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save assigned jobs for offline use."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Saving assigned jobs was interrupted."));
  }).finally(() => database.close());
}

export async function saveAssignedWorkOrder(userId: string, workOrder: WorkOrder): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(WORK_ORDERS_STORE, "readwrite");
    transaction.objectStore(WORK_ORDERS_STORE).put({
      cacheKey: cacheKey(userId, workOrder.id), userId, workOrder, savedAt: Date.now(),
    } satisfies CachedWorkOrder);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function getCachedAssignedWorkOrders(userId: string): Promise<{ workOrders: WorkOrder[]; savedAt: number } | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(WORK_ORDERS_STORE, "readonly");
    const records = await requestResult(transaction.objectStore(WORK_ORDERS_STORE).index("userId").getAll(userId)) as CachedWorkOrder[];
    await transactionDone(transaction);
    const fresh = records.filter((record) => Date.now() - record.savedAt <= WORK_ORDER_CACHE_MAX_AGE_MS);
    if (fresh.length === 0) return null;
    return { workOrders: fresh.map((record) => record.workOrder), savedAt: Math.min(...fresh.map((record) => record.savedAt)) };
  } finally {
    database.close();
  }
}

export async function getCachedAssignedWorkOrder(userId: string, workOrderId: string): Promise<{ workOrder: WorkOrder; savedAt: number } | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(WORK_ORDERS_STORE, "readonly");
    const record = await requestResult(transaction.objectStore(WORK_ORDERS_STORE).get(cacheKey(userId, workOrderId))) as CachedWorkOrder | undefined;
    await transactionDone(transaction);
    if (!record || Date.now() - record.savedAt > WORK_ORDER_CACHE_MAX_AGE_MS) return null;
    return { workOrder: record.workOrder, savedAt: record.savedAt };
  } finally {
    database.close();
  }
}

export async function saveServiceReportTypes(userId: string, types: ServiceReportType[]): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(REPORT_TYPES_STORE, "readwrite");
    transaction.objectStore(REPORT_TYPES_STORE).put({ userId, types, savedAt: Date.now() });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function getCachedServiceReportTypes(userId: string): Promise<ServiceReportType[] | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(REPORT_TYPES_STORE, "readonly");
    const record = await requestResult(transaction.objectStore(REPORT_TYPES_STORE).get(userId)) as
      { userId: string; types: ServiceReportType[]; savedAt: number } | undefined;
    await transactionDone(transaction);
    if (!record || Date.now() - record.savedAt > WORK_ORDER_CACHE_MAX_AGE_MS) return null;
    return record.types;
  } finally {
    database.close();
  }
}

export async function queueServiceReport(report: Omit<QueuedServiceReport, "queuedAt" | "status">): Promise<void> {
  if (report.file.size > MAX_OFFLINE_REPORT_BYTES) {
    throw new Error("This file is larger than 25 MB and cannot be saved for offline sending.");
  }
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(REPORTS_STORE, "readwrite");
    const store = transaction.objectStore(REPORTS_STORE);
    const request = store.index("userId").getAll(report.userId);
    let quotaError: Error | undefined;
    request.onsuccess = () => {
      const existing = (request.result as QueuedServiceReport[]).filter((item) => item.idempotencyKey !== report.idempotencyKey);
      const alreadyQueuedBytes = existing.reduce((sum, item) => sum + item.file.size, 0);
      if (alreadyQueuedBytes + report.file.size > MAX_QUEUED_REPORT_BYTES_PER_USER) {
        quotaError = new Error("Offline report storage is full. Reconnect and send or remove a saved report first.");
        transaction.abort();
        return;
      }
      store.put({ ...report, queuedAt: Date.now(), status: "PENDING" } satisfies QueuedServiceReport);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(quotaError ?? transaction.error ?? new Error("Could not save this report for offline sending."));
    transaction.onabort = () => reject(quotaError ?? transaction.error ?? new Error("Saving the offline report was interrupted."));
  }).finally(() => database.close());
}

export async function getQueuedServiceReports(userId: string): Promise<QueuedServiceReport[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(REPORTS_STORE, "readonly");
    const records = await requestResult(transaction.objectStore(REPORTS_STORE).index("userId").getAll(userId)) as QueuedServiceReport[];
    await transactionDone(transaction);
    return records.sort((left, right) => left.queuedAt - right.queuedAt);
  } finally {
    database.close();
  }
}

export async function removeQueuedServiceReport(idempotencyKey: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(REPORTS_STORE, "readwrite");
    transaction.objectStore(REPORTS_STORE).delete(idempotencyKey);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function markQueuedServiceReportNeedsAttention(idempotencyKey: string, errorMessage: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(REPORTS_STORE, "readwrite");
    const store = transaction.objectStore(REPORTS_STORE);
    const record = await requestResult(store.get(idempotencyKey)) as QueuedServiceReport | undefined;
    if (record) store.put({ ...record, status: "NEEDS_ATTENTION", errorMessage });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function clearCachedAssignedWorkOrders(userId: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([WORK_ORDERS_STORE, REPORT_TYPES_STORE], "readwrite");
    const cursorRequest = transaction.objectStore(WORK_ORDERS_STORE).index("userId").openCursor(IDBKeyRange.only(userId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    transaction.objectStore(REPORT_TYPES_STORE).delete(userId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear cached assigned jobs."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Clearing cached assigned jobs was interrupted."));
  }).finally(() => database.close());
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline storage request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline storage transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline storage transaction was interrupted."));
  });
}
