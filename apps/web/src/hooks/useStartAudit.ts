import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { addToHistory } from '../utils/history';

/** Creates an audit, remembers its id in this browser's history, and opens its page. Throws ApiRequestError for the form to display. */
export function useStartAudit() {
  const navigate = useNavigate();
  return useCallback(
    async (url: string) => {
      const created = await api.createAudit(url);
      addToHistory(created.id);
      navigate(`/audits/${created.id}`);
    },
    [navigate],
  );
}
