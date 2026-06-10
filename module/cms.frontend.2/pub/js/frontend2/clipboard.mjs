import { apt } from '../../../../core/pub/js/qino.js';

cms.frontend2.clipboard = pid => {
    const els = () => document.querySelectorAll('[qcms-id="'+pid+'"]');
    function close() {
        apt.cms.clipboard.put({ value: 0 });
        els().forEach(el => el.style.opacity = 1);
    }
    els().forEach(el => el.style.opacity = 0.4);
    apt.cms.node(pid).get().then(res => {
        cms.frontend2.dialog(
            'Paste from clipboard',
            '<table>'+
                '<tr><th> Title: &nbsp;<td> '+res.title+
                '<tr><th> Module: &nbsp;<td> '+res.module+
                '<tr><th> Id: &nbsp;<td> '+pid+
            '</table>',
            [{
                title: 'Paste on this page', then() {
                    cms.cont(pid).addPosition();
                    els().forEach(el => el.remove());
                    close();
                }
            },{
                title: 'Keep in place', then: close
            },{
                title: 'Close'
            }]
        );
    });
};
