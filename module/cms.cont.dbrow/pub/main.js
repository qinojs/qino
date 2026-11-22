// A row of cms.cont.dbrow: edits and uploads work as in the list of cms.cont.dbtable.
import { init } from '../../cms.cont.dbtable/pub/main.js';
import { initNode } from '@qino/m/cms/pub/js/cms.js';

initNode('cont.dbrow', init);
