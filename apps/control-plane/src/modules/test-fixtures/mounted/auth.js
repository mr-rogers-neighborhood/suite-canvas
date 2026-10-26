/** A module that satisfies the contract, used to prove the loader mounts one. */
export const module = {
  name: "auth",
  handle: (_request, response) => {
    response.writeHead(204);
    response.end();
    return true;
  },
};
