import {db} from './store.mjs';
import {createReportStore} from './reports.mjs';
export const savedReports=createReportStore(db);
