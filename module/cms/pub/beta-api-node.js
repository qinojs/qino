export class CMS {
  #nodes = new Map();

  constructor(api) {
    this.api = api;
  }

  node(id) {
    id = Number(id);
    let node = this.#nodes.get(id);
    if (node) return node;

    node = this.api.cms.node(id).get()
      .then(data => new Node(this, data))
      .catch(error => {
        if (this.#nodes.get(id) === node) this.#nodes.delete(id);
        throw error;
      });
    this.#nodes.set(id, node);
    return node;
  }
}

export class Node {
  constructor(cms, data) {
    this.cms = cms;
    Object.assign(this, data);
  }

  get api() {
    return this.cms.api.cms.node(this.id);
  }
}
