import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { WalletProvider } from './Wallet';
import App from './App';
import './styles.css';
class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return{failed:true};}
  componentDidCatch(_error:Error,_info:ErrorInfo){}
  render(){return this.state.failed?<main className="fatal"><h1>Let’s try that again.</h1><p>The page could not be loaded.</p><button className="button" onClick={()=>location.reload()}>Reload page</button></main>:this.props.children;}
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><WalletProvider><App/></WalletProvider></ErrorBoundary></React.StrictMode>);
