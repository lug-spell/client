import "office-ui-fabric-react/dist/css/fabric.min.css";
import App from "./ui/App";
import { AppContainer } from "react-hot-loader";
import { initializeIcons } from "office-ui-fabric-react/lib/Icons";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as config from "../config";
/* global AppContainer, Component, document, Office, module, require */

initializeIcons();

let isOfficeInitialized = false;

const render = Component => {
  ReactDOM.render(
    <AppContainer>
      <Component title={config.title} isOfficeInitialized={isOfficeInitialized} />
    </AppContainer>,
    document.getElementById("container")
  );
};

/* Render application after Office initializes */
Office.initialize = () => {
  isOfficeInitialized = true;
  render(App);
};

if ((module as any).hot) {
  (module as any).hot.accept("./ui/App", () => {
    if (!isOfficeInitialized) return;

    const NextApp = require("./ui/App").default;
    render(NextApp);
  });
}
