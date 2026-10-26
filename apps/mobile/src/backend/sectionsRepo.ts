import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Section } from '@atlagsebesseg/core';
import { rowToSection, type SectionRow } from '@atlagsebesseg/data/rows';
import { SectionCache, type BBox } from '../logic/sectionCache';
import { supabase } from './supabase';

async function fetchSectionsInBBox(b: BBox): Promise<Section[]> {
  if (!supabase) throw new Error('nincs Supabase-beállítás');
  const { data, error } = await supabase.rpc('sections_in_bbox', {
    p_south: b.south,
    p_west: b.west,
    p_north: b.north,
    p_east: b.east,
  });
  if (error) throw error;
  return (data as SectionRow[]).map(rowToSection);
}

/** Csempénkénti cache AsyncStorage-ben, 24 órás frissességgel; offline a lejárt cache is jó. */
export const sectionCache = new SectionCache(AsyncStorage, fetchSectionsInBBox);
