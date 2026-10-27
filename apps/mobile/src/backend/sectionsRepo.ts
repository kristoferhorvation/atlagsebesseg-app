import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchSectionsInBBox, SectionCache } from '@atlagsebesseg/app-logic';
import { supabase } from './supabase';

/** Csempénkénti cache AsyncStorage-ben, 24 órás frissességgel; offline a lejárt cache is jó. */
export const sectionCache = new SectionCache(AsyncStorage, (b) => fetchSectionsInBBox(supabase, b));
