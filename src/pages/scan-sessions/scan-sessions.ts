import { Component } from '@angular/core';
import { Device } from '@ionic-native/device';
import { GoogleAnalytics } from '@ionic-native/google-analytics';
import { LaunchReview } from '@ionic-native/launch-review';
import * as BluebirdPromise from 'bluebird';
import { AlertController, ItemSliding, NavController, PopoverController } from 'ionic-angular';
import * as Supplant from 'supplant';
import { requestModelDeleteScanSessions } from '../../models/request.model';
import { ScanSessionModel } from '../../models/scan-session.model';
import { ScanModel } from '../../models/scan.model';
import { wsEvent } from '../../models/ws-event.model';
import { Config } from '../../providers/config';
import { ScanSessionsStorage } from '../../providers/scan-sessions-storage';
import { ServerProvider } from '../../providers/server';
import { Utils } from '../../providers/utils';
import { ScanSessionPage } from '../scan-session/scan-session';
import { SelectServerPage } from '../select-server/select-server';
import { Settings } from './../../providers/settings';


@Component({
  selector: 'page-scannings',
  templateUrl: 'scan-sessions.html',
})
export class ScanSessionsPage {
  public connected = false;
  public scanSessions: ScanSessionModel[] = [];
  public selectedScanSessions: ScanSessionModel[] = [];

  private responseSubscription = null;
  private wsEventSubscription = null;
  private preventClickTimeout = null;
  private clickDisabled = false;

  constructor(
    public navCtrl: NavController,
    private alertCtrl: AlertController,
    private serverProvider: ServerProvider,
    private scanSessionsStorage: ScanSessionsStorage,
    public popoverCtrl: PopoverController,
    private ga: GoogleAnalytics,
    private settings: Settings,
    private launchReview: LaunchReview,
    private device: Device,
    private utils: Utils
  ) { }

  ionViewDidEnter() {
    this.ga.trackView('ScanSessionsPage');

    this.scanSessionsStorage.getScanSessions().then(data => {
      this.scanSessions = data;
      if (Config.DEBUG && this.scanSessions && this.scanSessions.length == 0) {
        let scanSessionDate = new Date().getTime();
        for (let i = 0; i < 50; i++) {
          let scannings = [];
          scanSessionDate += Math.floor(Math.random() * 9999999) + 9999999;
          let scanDate = scanSessionDate;
          for (let j = 0; j < 500; j++) {
            let scan = new ScanModel();
            scan.cancelled = false;
            scan.id = scanDate;
            scan.date = scanDate;
            scan.repeated = false;
            scan.outputBlocks = [
              { name: 'BARCODE', value: j + ' - ' + Math.floor(Math.random() * 99999999999) + '', type: 'barcode' },
              { name: 'ENTER', value: 'tab', type: 'key' },
              { name: 'QUANTITY', value: '5', type: 'variable' },
              { name: 'ENTER', value: 'enter', type: 'key' }];
            scan.displayValue = ScanModel.ToString(scan);
            scannings.push(scan);
            scanDate += Math.floor(Math.random() * 2000) + 1500;
          }
          let newScanSession: ScanSessionModel = {
            id: scanSessionDate,
            name: 'Scan session ' + i,
            date: scanSessionDate,
            scannings: scannings,
            selected: false,
          };
          this.scanSessions.push(newScanSession);
          // Looking for scanSessions.push? See: scanSessionsStorage.updateScanSession
        }
        this.scanSessionsStorage.setScanSessions(this.scanSessions)
      }
    });

    // if (this.connected == false) {
    this.settings.getDefaultServer().then(server => {
      // console.log('SERVER: ', server)

      if (!this.wsEventSubscription) {
        this.wsEventSubscription = this.serverProvider.onWsEvent().subscribe((event: wsEvent) => {
          // console.log('[S-SESSIONS]: ' + event.name)
          this.connected = this.serverProvider.isConnected();
          if (event.name == wsEvent.EVENT_OPEN) {
            this.onConnect();
          }
        });
      }


      // if (!this.responseSubscription) {
      //   this.responseSubscription = this.serverProvider.onResponse().subscribe((response: any) => {

      //   });
      // }

      // console.log('[S-SESSIONS]: connect()')
      this.serverProvider.connect(server);
    }, err => { })
    // }
  }

  ionViewDidLoad() {
    this.utils.showEnableWifiDialog();
  }

  ionViewDidLeave() {
    if (this.responseSubscription) {
      this.responseSubscription.unsubscribe();
      this.responseSubscription = null;
    }

    if (this.wsEventSubscription) {
      this.wsEventSubscription.unsubscribe();
      this.wsEventSubscription = null;
    }
  }

  ionViewWillLeave() {
    this.unselectAll();
  }

  private onConnect() {
    BluebirdPromise.join(this.settings.getNoRunnings(), this.settings.getRated(), (runnings, rated) => {
      if (runnings >= Config.NO_RUNNINGS_BEFORE_SHOW_RATING && !rated) {
        let os = this.device.platform || 'unknown';
        let isAndroid = os.toLowerCase().indexOf('android') != -1;
        let store = isAndroid ? 'PlayStore' : 'Appstore';
        this.alertCtrl.create({
          title: 'Rate Barcode to PC',
          message: 'Is Barcode to PC helping you transfer barcodes?<br><br>Let the world know by rating it on the ' + store + ', it would be appreciated!',
          buttons: [{
            text: 'Remind me later',
            role: 'cancel'
          }, {
            text: 'No',
            handler: () => {
              this.settings.setRated(true);
            }
          }, {
            text: 'Rate',
            handler: () => {
              if (this.launchReview.isRatingSupported()) {
                this.launchReview.rating().then(result => {
                  if (result == 'shown') {
                    this.settings.setRated(true);
                  }
                });
              } else {
                this.launchReview.launch().then(() => {
                  this.settings.setRated(true);
                })
              }
            }
          }]
        }).present();
      }
    });
  }

  onSelectServerClick() {
    this.navCtrl.push(SelectServerPage);
  }

  onScanSessionClick(scanSession, index: number) {
    if (this.clickDisabled) return; // prevent click after long press

    if (this.selectedScanSessions.length == 0) {
      // this.cancelSelection();
      this.navCtrl.push(ScanSessionPage, { scanSession: scanSession, isNewSession: false });
    } else {
      this.select(scanSession, index);
    }
  }

  onSelectAllClick() {
    this.scanSessions.forEach(x => x.selected = true);
    this.selectedScanSessions = [].concat(this.scanSessions);
  }

  onScanSessionPress(scanSession: ScanSessionModel, index: number) {
    if (this.selectedScanSessions.length == 0) { // prevent click after long press
      if (this.preventClickTimeout) clearTimeout(this.preventClickTimeout);
      this.clickDisabled = true;
      this.preventClickTimeout = setTimeout(() => this.clickDisabled = false, 500);
    }

    this.select(scanSession, index);
  }

  onCancelSelectionClick() {
    this.unselectAll();
  }

  onDeleteClick(scanSession: ScanSessionModel, index: number, slidingItem: ItemSliding) {
    slidingItem.close();
    this.alertCtrl.create({
      title: 'Confirm delete',
      message: 'Do you really want to delete ' + scanSession.name + '?',
      buttons: [{
        text: 'Cancel', role: 'cancel'
      }, {
        text: 'Delete', handler: () => {
          if (!this.connected) {
            this.utils.showCannotPerformActionOffline();
            return;
          }

          this.removeScanSession(index);
          this.save();
          this.sendDeleteScanSessions([scanSession]);
        }
      }]
    }).present();
  }

  private unselectAll() {
    this.selectedScanSessions.forEach(x => x.selected = false);
    this.selectedScanSessions = [];
  }

  private select(scanSession: ScanSessionModel, index: number) {
    if (scanSession.selected) {
      scanSession.selected = false;
      if (this.selectedScanSessions.length == 1) {
        this.selectedScanSessions = [];
      } else {
        this.selectedScanSessions.splice(index, 1);
      }
    } else {
      scanSession.selected = true;
      this.selectedScanSessions.push(scanSession);
    }
  }

  // ScanSessions.OnAddClick() -> ScanSession.GetScanMode()
  async onAddClick() {
    let date: number = new Date().getTime();
    let name = await this.settings.getScanSessionName();
    name = new Supplant().text(name, {
      scan_session_number: this.scanSessions.length + 1,
      device_name: await this.settings.getDeviceName(),
      date: new Date().toISOString().slice(0, 10).replace(/-/g, "")
    });
    let newScanSession: ScanSessionModel = {
      id: date,
      name: name,
      date: date,
      scannings: [],
      selected: false,
    };
    this.navCtrl.push(ScanSessionPage, { scanSession: newScanSession, isNewSession: true });
  }

  onArchiveSelectedClick() {
    if (!this.connected) {
      this.utils.showCannotPerformActionOffline();
      return;
    }

    let wsRequest = new requestModelDeleteScanSessions().fromObject({
      scanSessionIds: this.selectedScanSessions.map(x => x.id)
    });
    this.serverProvider.send(wsRequest);

    this.scanSessions = this.scanSessions.filter(x => !x.selected);
    this.scanSessionsStorage.pushArchivedScanSessions(this.selectedScanSessions)
    this.unselectAll();
    this.save();
  }

  onDeleteSelectedClick() {
    this.alertCtrl.create({
      title: 'Confirm delete',
      message: 'Do you really want to delete the selected scan sessions?',
      buttons: [{
        text: 'Cancel', role: 'cancel'
      }, {
        text: 'Delete', handler: () => {
          if (!this.connected) {
            this.utils.showCannotPerformActionOffline();
            return;
          }

          this.sendDeleteScanSessions(this.selectedScanSessions);
          this.scanSessions = this.scanSessions.filter(x => !x.selected);
          this.unselectAll();
          this.save();
        }
      }]
    }).present();
  }

  // onClearScanSessionsClick() {
  //   this.alertCtrl.create({
  //     title: 'Confirm delete',
  //     message: 'Do you really want to delete ALL scan sessions?',
  //     buttons: [{
  //       text: 'Cancel', role: 'cancel'
  //     }, {
  //       text: 'Delete', handler: () => {
  //         if (!this.connected) {
  //           this.showCannotDeleteOffline();
  //           return;
  //         }

  //         this.scanSessions = [];
  //         this.save();
  //         this.sendClearScanSessions();
  //       }
  //     }]
  //   }).present();
  // }



  // private sendClearScanSessions() {
  //   this.serverProvider.send(new requestModelClearScanSessions().fromObject({}));
  // }

  private sendDeleteScanSessions(scanSessions: ScanSessionModel[]) {
    let wsRequest = new requestModelDeleteScanSessions().fromObject({
      scanSessionIds: scanSessions.map(x => { return x.id })
    });
    this.serverProvider.send(wsRequest);
  }

  private save() {
    console.log('[storage] setScanSessions() 1')
    this.scanSessionsStorage.setScanSessions(this.scanSessions);
  }

  private removeScanSession(index: number) {
    if (this.scanSessions.length == 1) {
      this.scanSessions = [];
    } else {
      this.scanSessions.splice(index, 1);
    }
  }
}