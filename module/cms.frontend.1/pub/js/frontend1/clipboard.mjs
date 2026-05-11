import { apt } from '../../../../core/pub/js/apt.js';

cms.frontend1.clipboard = pid => {
    function close() {
        apt.cms.clipboard.put({ value: 0 });
        $('.-pid'+pid).css({opacity: 1});
    }
    $('.-pid'+pid).css({opacity: 0.4});
    apt.cms.node(pid).get().then(res => {
        cms.frontend1.dialog(
            'Aus der Zwischenablage einfügen',
            '<table>'+
                '<tr><th> Titel: &nbsp;<td> '+res.title+
                '<tr><th> Modul: &nbsp;<td> '+res.module+
                '<tr><th> Id: &nbsp;<td> '+pid+
            '</table>',
            [{
                title: 'Auf dieser Seite einfügen', then() {
                    cms.cont(pid).addPosition();
                    $('.-pid'+pid).remove();
                    close();
                }
            },{
                title: 'Am alten Ort behalten', then: close
            },{
                title: 'Schliessen'
            }]
        );
    });
};
