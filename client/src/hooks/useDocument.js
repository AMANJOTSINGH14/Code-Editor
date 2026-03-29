import { useCallback, useEffect, useState } from "react";
import api from "../services/api.js";

/**
 * Hook to fetch a document by id.
 * @param {string} documentId - Document id.
 * @returns {Object} Document state and helpers.
 */
export function useDocument(documentId) {
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchDocument = useCallback(async () => {
    if (!documentId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(`/api/documents/${documentId}`);
      const doc = response.data.data.document;
      const snapshotText = response.data.data.snapshotText;
      setDocument({ ...doc, snapshotText });
    } catch (fetchError) {
      setError(fetchError);
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    fetchDocument();
  }, [fetchDocument]);

  return { document, loading, error, refresh: fetchDocument };
}
