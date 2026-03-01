import { useState, useMemo, useCallback } from 'react';
import type { ApiFilm, TranscodeStatus } from '../../../api';

export interface AdminFilmFilters {
  search: string;
  aisle: string;
  status: string;
  genre: string;
  sortBy: 'title' | 'date' | 'aisle' | 'year';
  sortDir: 'asc' | 'desc';
}

const DEFAULT_FILTERS: AdminFilmFilters = {
  search: '',
  aisle: 'all',
  status: 'all',
  genre: 'all',
  sortBy: 'title',
  sortDir: 'asc',
};

export function useAdminFilms(adminFilms: ApiFilm[], transcodeStatuses: Map<number, TranscodeStatus>) {
  const [filters, setFilters] = useState<AdminFilmFilters>(DEFAULT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Extract unique genres from all films
  const uniqueGenres = useMemo(() => {
    const genreSet = new Set<string>();
    for (const film of adminFilms) {
      if (film.genres) {
        for (const g of film.genres) {
          genreSet.add(g.name);
        }
      }
    }
    return Array.from(genreSet).sort();
  }, [adminFilms]);

  // Filter films
  const filteredFilms = useMemo(() => {
    let result = adminFilms;

    // Search
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(f =>
        f.title.toLowerCase().includes(q) ||
        String(f.tmdb_id).includes(q)
      );
    }

    // Aisle
    if (filters.aisle !== 'all') {
      if (filters.aisle === 'no-aisle') {
        result = result.filter(f => !f.aisle);
      } else {
        result = result.filter(f => f.aisle === filters.aisle);
      }
    }

    // Status
    if (filters.status !== 'all') {
      switch (filters.status) {
        case 'available':
          result = result.filter(f => f.is_available);
          break;
        case 'hidden':
          result = result.filter(f => !f.is_available);
          break;
        case 'downloading': {
          result = result.filter(f => {
            const hasRadarr = f.radarr_vo_id || f.radarr_vf_id;
            const ts = transcodeStatuses.get(f.id);
            return hasRadarr && !ts?.file_path_vo && !ts?.file_path_vf;
          });
          break;
        }
        case 'no-aisle':
          result = result.filter(f => !f.aisle);
          break;
      }
    }

    // Genre
    if (filters.genre !== 'all') {
      result = result.filter(f =>
        f.genres?.some(g => g.name === filters.genre)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (filters.sortBy) {
        case 'title':
          cmp = a.title.localeCompare(b.title, 'fr');
          break;
        case 'date':
          cmp = (a.created_at || '').localeCompare(b.created_at || '');
          break;
        case 'aisle':
          cmp = (a.aisle || 'zzz').localeCompare(b.aisle || 'zzz');
          break;
        case 'year':
          cmp = (a.release_year || 0) - (b.release_year || 0);
          break;
      }
      return filters.sortDir === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [adminFilms, filters, transcodeStatuses]);

  // Filter setters
  const setSearch = useCallback((search: string) => {
    setFilters(f => ({ ...f, search }));
  }, []);

  const setAisle = useCallback((aisle: string) => {
    setFilters(f => ({ ...f, aisle }));
  }, []);

  const setStatus = useCallback((status: string) => {
    setFilters(f => ({ ...f, status }));
  }, []);

  const setGenre = useCallback((genre: string) => {
    setFilters(f => ({ ...f, genre }));
  }, []);

  const setSortBy = useCallback((sortBy: AdminFilmFilters['sortBy']) => {
    setFilters(f => {
      if (f.sortBy === sortBy) {
        return { ...f, sortDir: f.sortDir === 'asc' ? 'desc' : 'asc' };
      }
      return { ...f, sortBy, sortDir: 'asc' };
    });
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  // Bulk selection
  const toggleSelected = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filteredFilms.map(f => f.id)));
  }, [filteredFilms]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  return {
    filters,
    filteredFilms,
    uniqueGenres,
    setSearch,
    setAisle,
    setStatus,
    setGenre,
    setSortBy,
    resetFilters,
    selectedIds,
    toggleSelected,
    selectAll,
    clearSelection,
  };
}
