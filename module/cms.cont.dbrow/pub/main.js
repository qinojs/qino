// A row of cms.cont.dbrow: edits and uploads work as in the list of cms.cont.dbtable.
import { init } from '../../cms.cont.dbtable/pub/main.js';

for (const root of document.querySelectorAll('[qcms-mod="cont.dbrow"]')) init(root);
