let rte = window.c1.rte = {};

/*
rte.blockElements = {
    'DIV':1,
    'P':1,
    'H1':1,
    'H2':1,
    'H3':1,
    'H4':1,
    'H5':1,
    'H6':1,
    'UL':1,
    'LI':1,
};
*/
rte.blocklessElements = {
    'P':1,
    'H1':1,
    'H2':1,
    'H3':1,
    'H4':1,
    'H5':1,
    'H6':1,
    'SPAN':1,
    'BUTTON':1,
    'B':1,
    'I':1,
    'STRONG':1,
    'LABEL':1,
    'A':1,
}

/*
rte.isRoot = function(el) {
    return !el.parentNode || !el.parentNode.isContentEditable;
}
*/