/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
import { apt } from '../../../core/pub/js/apt.js';

window.cmsTreeInit = async (json) => {
  c1Use.able(window, "jQuery");
  c1Use.able(jQuery, "fn");
  await jQuery.fn.c1Use("dynatree");

  // var dblClick = false;
  cms.Tree = $("#cmsTreeContainer").dynatree({
    debugLevel: 0,
    activeVisible: true,
    onActivate(node) {
      if (node.data.myaccess < 2 || node.data.type === "c") {
        $("#cmsPageAddInp").css({ opacity: .2 }).attr("disabled", true);
      } else {
        $("#cmsPageAddInp").css({ opacity: 1 }).attr("disabled", false);
      }
      const el = $(".-pid" + node.data.key)[0];
      if (!el) return;
      cms.contPos(el).mark();
    },
    onLazyRead(node) {
      const id = node.data.key;
      apt.cms.node(id).tree.get({
        level: 1,
        filter: cms.panel.data.tree_show_c ? "*" : "p",
      }).then((res) => {
        node.addChild(res);
        node.setLazyNodeStatus(DTNodeStatus_Ok);
      });
    },
    onFocus(node) {
      node.activate();
    },
    onClick(node, e) {
      if (e.shiftKey) {
        cms.Tree.editNode(node);
        return false;
      }
      if (e.target.closest("a")) {
        if (e.ctrlKey) open(node.data.url, "_blank");
        else location.href = node.data.url;
      }
    },
    onKeydown(node, e) {
      if (e.target.isContentEditable || e.target.form !== undefined) return;
      if (e.key === "Enter") {
        location.href = node.data.url;
      }
      if (e.key === "Delete" && !e.ctrlKey) {
        if (node.data.myaccess < 3) return;
        if (!confirm('Seite "' + node.data.title + '" wirklich löschen?')) {
          return;
        }
        apt.cms.node(node.data.key).delete();
      }
      if (e.key === "F2") {
        cms.Tree.editNode(node);
        return false;
      }
    },
    onCreate(node, span) {
      const d = node.data;
      node.li.title = "ID " + d.key;
    },
    onCustomRender(node) {
      var d = node.data;
      d.addClass += " -access-" + d.myaccess;
      if (d.type !== "p") d.addClass += " -type-" + d.type;
      if (!d.visible) d.addClass += " -invisible";
      var html = "<a class=dynatree-title href=#>";
      html += "<span cmstxt=" + d.title_id + ">" + d.title + "</span>";
      if (d.type === "c") {
        html += ' <span class=-col1 title="' + d.module + '"> ' +
          d.module.replace(/^cms\.cont\./, "") + " </span> ";
      }
      html += " <span class=-col2> " + (d.name || "") + " </span> ";
      if (!d.public) html += "<span class=-private   title=private></span>";
      if (!d.online) html += "<span class=-offline   title=offline></span>";
      //if (!d.visible) html += '<span class=-invisible title="not in nav"></span>';
      html += "</a>";
      return html;
    },
    dnd: {
      onDragStart(node) {
        document.querySelector(".dynatree-drag-helper").c1ZTop();
        //if (node.parent.data.myaccess > 1 || node.data.myaccess > 2) return true;
        if (node.data.myaccess < 2) return false;
        return true;
      },
      onDragEnter(target, source) {
        const access = [];
        if (target.data.type === "c" && source.data.type === "p") return access;
        target.data.myaccess > 1 && access.push("over");
        target.parent.data.myaccess > 1 && access.push("before", "after");
        return access;
      },
      onDrop(target, source, where, ui, draggable) {
        const parent = where === "over"
          ? target.data.key
          : target.getParent().data.key;
        let before = null;
        if (where === "after") {
          const next = target.getNextSibling();
          before = next ? next.data.key : null;
        } else if (where === "before") {
          before = target.data.key;
        }
        apt.cms.node(String(parent)).insertBefore.put({ id: source.data.key, before: before ? String(before) : undefined }).then(() => {
          source.move(target, where);
        });
      },
      autoExpandMS: 700,
    },
  }).dynatree("getTree");

  cms.Tree.addPage = (name) => {
    let parent = cms.Tree.activeNode;
    parent.expand(1);
    apt.cms.node(parent.data.key).children.post({ title: name }).then((child) => {
      if (!child) return false;
      let node = parent.addChild(
        child,
        parent.childList && parent.childList[0],
      );
      parent.expand(1);
      node.span.classList.add("-new");
      setTimeout(() => node.span.classList.remove("-new"), 2000);
    });
  };

  /* init */
  const root = cms.Tree.getRoot();
  root.addChild(json);

  setTimeout(() => {
    root.visit((node) => node.childList && node.expand(true));
  });

  var pid = cms.cont.active || Page;
  cms.Tree.activateKey(pid + "");
  cms.Tree.activeNode && cms.Tree.activeNode.expand();

  /*edit*/
  var editInput = $(
    '<input style="width:220px; margin:-3px; padding:2px; border:none; background:#fff; font-size:inherit; color:#444">',
  );
  var mousedownOutside = (e) => {
    e.target !== editInput[0] && editInput.trigger("blur");
  };
  cms.Tree.editNode = (node) => {
    var $widget = node.tree.$widget;
    $widget.unbind(); // Disable dynatree mouse- and key handling
    $widget.element.on("mousedown", mousedownOutside);
    $(".dynatree-title", node.span).removeAttr("href").html(editInput);
    editInput.val(node.data.title).focus();
    editInput[0].onkeyup = (e) => {
      e.key === "Escape" && editInput.val(node.data.title) &&
        editInput.trigger("blur");
      e.key === "Enter" && editInput.trigger("blur");
    };
    editInput[0].onblur = (e) => {
      var title = editInput.val();
      apt.cms.txt(node.data.title_id).put({ value: title }).then(() => {
        node.setTitle(title);
      });
      $widget.bind();
      $widget.element.off("mousedown", mousedownOutside);
      node.focus();
    };
  };
  cms.Tree.goTo = (pid) => {
    pid = pid + "";
    //var node = cms.Tree.getNodeByKey(pid);
    apt.cms.tree.get({
      "in": pid,
      filter: cms.panel.data.tree_show_c ? "*" : "p",
    }).then((json) => {
      var root = cms.Tree.getRoot();
      root.removeChildren();
      root.addChild(json);
      cms.Tree.activateKey(pid);
      cms.Tree.activeNode && cms.Tree.activeNode.expand();
    });
  };
  /* activate content (mark) */
  function mouseEnterLeave(e) {
    let el = e.target.closest("li");
    if (!el || !el.title) return;
    var id = el.title.match(/^ID ([0-9]+)/)[1];
    if (!id) return;
    el = document.querySelector(".-pid" + id);
    if (!el) return;
    if (e.type === "mouseenter") {
      if (cms.contPos.active?.el === el) return;
      cms.contPos(el).mark();
    } else {
      cms.contPos(el).unmark();
    }
  }
  var divTree = cms.Tree.divTree;
  divTree.addEventListener("mouseenter", mouseEnterLeave, true);
  divTree.addEventListener("mouseleave", mouseEnterLeave, true);
};

/* server listener */
apt.on("PUT cms/node/:id/online-start|PUT cms/node/:id/online-end|PUT cms/node/:id/access", ({ params: { id } }) => {
  if (!cms.Tree) return;
  const node = cms.Tree.getNodeByKey(id);
  if (!node) return;
  apt.cms.node(id).get().then((data) => {
    data.key = "" + data.key;
    node.data = data;
    node.render();
  });
  node.data.isLazy && node.reloadChildren(() => cms.Tree.activateKey(id));
});
apt.on("PUT cms/node/:id/visible", ({ params: { id }, input }) => {
  if (!cms.Tree) return;
  const node = cms.Tree.getNodeByKey(id);
  if (!node) return;
  node.data.visible = input?.value;
  node.render();
});
apt.on("PUT cms/node/:id/insertBefore", ({ input }) => {
  if (!cms.Tree) return;
  cms.Tree.goTo(input?.id);
});
apt.on("DELETE cms/node/:id", ({ params: { id } }) => {
  if (!cms.Tree) return;
  const node = cms.Tree.getNodeByKey(id);
  if (!node) return;
  if (cms.Tree.activeNode === node) {
    const nextActive = node.getPrevSibling() || node.getNextSibling() || node.parent;
    nextActive && nextActive.activate();
  }
  node.remove();
});
