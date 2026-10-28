/* Panel widget: the one of cms.cont.dbtable, without what only a list does. */
import { setup } from '../../cms.cont.dbtable/pub/widget.js';

export { css } from '../../cms.cont.dbtable/pub/widget.js';
export default setup({ flags: ['edit'], list: false });
