import * as rxjs from 'rxjs';
import type { Observer } from 'rxjs';
import { Grid, GridOptions } from 'ag-grid-community';
import { Notyf } from 'notyf';

import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import 'notyf/notyf.min.css';
import './index.css';

declare global {
  var country: string;
  function gradioApp(): HTMLElement;
  function randomId(): string;
  function get_tab_index(name: string): number;
  function create_submit_args(args: IArguments): any[];
  function requestProgress(
    id: string,
    progressContainer: HTMLElement,
    imagesContainer: HTMLElement,
    onDone: () => void,
  ): void;
  function onUiLoaded(callback: () => void): void;
  function submit_enqueue(): any[];
  function submit_enqueue_img2img(): any[];
}

type Task = {
  id: string;
  api_task_id: string;
  type: string;
  status: string;
  params: Record<string, any>;
  priority: number;
  result: string;
};

type AppState = {
  current_task_id: string | null;
  total_pending_tasks: number;
  pending_tasks: Task[];
  paused: boolean;
};

function initTaskScheduler() {
  const notyf = new Notyf();
  const subject = new rxjs.Subject<AppState>();

  const store = {
    subject,
    subscribe: (callback: Partial<Observer<[AppState, AppState]>>) => {
      return store.subject.pipe(rxjs.pairwise()).subscribe(callback);
    },
    refresh: async () => {
      return fetch('/agent-scheduler/v1/queue?limit=1000')
        .then((response) => response.json())
        .then((data: AppState) => {
          const pending_tasks = data.pending_tasks.map((item) => ({
            ...item,
            params: JSON.parse(item.params as any),
            status: item.id === data.current_task_id ? 'running' : 'pending',
          }));
          store.subject.next({
            ...data,
            pending_tasks,
          });
        });
    },
    pauseQueue: async () => {
      return fetch('/agent-scheduler/v1/pause', { method: 'POST' })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            notyf.success(data.message);
          } else {
            notyf.error(data.message);
          }

          return store.refresh();
        });
    },
    resumeQueue: async () => {
      return fetch('/agent-scheduler/v1/resume', { method: 'POST' })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            notyf.success(data.message);
          } else {
            notyf.error(data.message);
          }

          return store.refresh();
        });
    },
    runTask: async (id: string) => {
      return fetch(`/agent-scheduler/v1/run/${id}`, { method: 'POST' })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            notyf.success(data.message);
          } else {
            notyf.error(data.message);
          }

          return store.refresh();
        });
    },
    deleteTask: async (id: string) => {
      return fetch(`/agent-scheduler/v1/delete/${id}`, { method: 'POST' })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            notyf.success(data.message);
          } else {
            notyf.error(data.message);
          }

          return store.refresh();
        });
    },
    moveTask: async (id: string, overId: string) => {
      return fetch(`/agent-scheduler/v1/move/${id}/${overId}`, { method: 'POST' })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            notyf.success(data.message);
          } else {
            notyf.error(data.message);
          }

          return store.refresh();
        });
    },
  };

  store.subject.next({
    current_task_id: null,
    total_pending_tasks: 0,
    pending_tasks: [],
    paused: false,
  });

  window.submit_enqueue = function submit_enqueue() {
    var id = randomId();
    var res = create_submit_args(arguments);
    res[0] = id;

    const btnEnqueue = document.querySelector('#txt2img_enqueue');
    if (btnEnqueue) {
      btnEnqueue.innerHTML = 'Queued';
      setTimeout(() => {
        btnEnqueue.innerHTML = 'Enqueue';
        store.refresh();
      }, 1000);
    }

    return res;
  };

  window.submit_enqueue_img2img = function submit_enqueue_img2img() {
    var id = randomId();
    var res = create_submit_args(arguments);
    res[0] = id;
    res[1] = get_tab_index('mode_img2img');

    const btnEnqueue = document.querySelector('#img2img_enqueue');
    if (btnEnqueue) {
      btnEnqueue.innerHTML = 'Queued';
      setTimeout(() => {
        btnEnqueue.innerHTML = 'Enqueue';
        store.refresh();
      }, 1000);
    }

    return res;
  };

  // detect queue button placement
  const interrogateCol: HTMLDivElement = gradioApp().querySelector('.interrogate-col')!;
  if (interrogateCol.childElementCount > 2) {
    interrogateCol.classList.add('has-queue-button');
  }

  // watch for tab activation
  const observer = new MutationObserver(function (mutationsList) {
    const styleChange = mutationsList.find((mutation) => mutation.attributeName === 'style');
    if (styleChange) {
      const tab = styleChange.target as HTMLElement;
      if (tab.style.display === 'block') {
        store.refresh();
      }
    }
  });
  observer.observe(document.getElementById('tab_agent_scheduler')!, { attributes: true });

  // init actions
  const refreshButton = gradioApp().querySelector('#agent_scheduler_action_refresh')!;
  const pauseButton = gradioApp().querySelector('#agent_scheduler_action_pause')!;
  const resumeButton = gradioApp().querySelector('#agent_scheduler_action_resume')!;
  refreshButton.addEventListener('click', store.refresh);
  pauseButton.addEventListener('click', store.pauseQueue);
  resumeButton.addEventListener('click', store.resumeQueue);

  const searchContainer = gradioApp().querySelector('#agent_scheduler_action_search')!;
  searchContainer.className = 'ts-search';
  searchContainer.innerHTML = `
  <div class="ts-search-icon">
  <svg width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/>
    <path d="M21 21l-6 -6"/>
  </svg>
  </div>
  <input type="text" id="agent_scheduler_search_input" class="ts-search-input" placeholder="Search" required>
`;

  // watch for current task id change
  const onTaskIdChange = (id: string | null) => {
    if (id) {
      requestProgress(
        id,
        gradioApp().querySelector('#agent_scheduler_current_task_progress')!,
        gradioApp().querySelector('#agent_scheduler_current_task_images')!,
        () => {
          setTimeout(() => {
            store.refresh();
          }, 1000);
        },
      );
    }
  };
  store.subscribe({
    next: ([prev, curr]) => {
      if (prev.current_task_id !== curr.current_task_id) {
        onTaskIdChange(curr.current_task_id);
      }
      if (curr.paused) {
        pauseButton.classList.add('hide');
        resumeButton.classList.remove('hide');
      } else {
        pauseButton.classList.remove('hide');
        resumeButton.classList.add('hide');
      }
    },
  });

  // init grid
  const deleteIcon = `
    <svg width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
      <path d="M4 7l16 0"/>
      <path d="M10 11l0 6"/>
      <path d="M14 11l0 6"/>
      <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/>
      <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/>
    </svg>`;
  const cancelIcon = `
    <svg width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
      <path d="M18 6l-12 12"/>
      <path d="M6 6l12 12"/>
    </svg>
  `;
  const pendingTasksGridOptions: GridOptions<Task> = {
    // domLayout: 'autoHeight',
    // default col def properties get applied to all columns
    defaultColDef: {
      sortable: false,
      filter: true,
      resizable: true,
      suppressMenu: true,
    },
    // each entry here represents one column
    columnDefs: [
      {
        field: 'id',
        headerName: 'Task Id',
        minWidth: 240,
        maxWidth: 240,
        pinned: 'left',
        rowDrag: true,
        cellClass: ({ data }) => [
          data?.status === 'running' ? 'task-running' : '',
        ],
      },
      {
        field: 'type',
        headerName: 'Type',
        minWidth: 80,
        maxWidth: 80,
      },
      {
        field: 'priority',
        headerName: 'Priority',
        hide: true,
      },
      {
        headerName: 'Params',
        children: [
          {
            field: 'params.prompt',
            headerName: 'Prompt',
            minWidth: 400,
            autoHeight: true,
            wrapText: true,
            cellStyle: { 'line-height': '24px', 'padding-top': '8px', 'padding-bottom': '8px' },
          },
          {
            field: 'params.negative_prompt',
            headerName: 'Negative Prompt',
            minWidth: 400,
            autoHeight: true,
            wrapText: true,
            cellStyle: { 'line-height': '24px', 'padding-top': '8px', 'padding-bottom': '8px' },
          },
          {
            field: 'params.checkpoint',
            headerName: 'Checkpoint',
            minWidth: 150,
            maxWidth: 300,
            valueFormatter: ({ value }) => value || 'System',
          },
          {
            field: 'params.sampler_name',
            headerName: 'Sampler',
            width: 150,
            minWidth: 150,
          },
          {
            field: 'params.steps',
            headerName: 'Steps',
            minWidth: 80,
            maxWidth: 80,
            filter: 'agNumberColumnFilter',
          },
          {
            field: 'params.cfg_scale',
            headerName: 'CFG Scale',
            width: 100,
            minWidth: 100,
            filter: 'agNumberColumnFilter',
          },
          {
            field: 'params.size',
            headerName: 'Size',
            minWidth: 110,
            maxWidth: 110,
            valueGetter: ({ data }) => (data ? `${data.params.width}x${data.params.height}` : ''),
          },
          {
            field: 'params.batch',
            headerName: 'Batching',
            minWidth: 100,
            maxWidth: 100,
            valueGetter: ({ data }) =>
              data ? `${data.params.n_iter}x${data.params.batch_size}` : '1x1',
          },
        ],
      },
      { field: 'created_at', headerName: 'Date', minWidth: 200 },
      {
        headerName: 'Action',
        pinned: 'right',
        minWidth: 110,
        maxWidth: 110,
        resizable: false,
        valueGetter: ({ data }) => data?.id,
        cellRenderer: ({ api, value, data }: any) => {
          const html = `
            <div class="inline-flex rounded-md shadow-sm mt-1.5" role="group">
              <button type="button" ${
                data.status === 'running' ? 'disabled' : ''
              } class="ts-btn-action ts-btn-run">
                <svg width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
                  <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                  <path d="M7 4v16l13 -8z"/>
                </svg>
              </button>
              <button type="button" class="ts-btn-action ts-btn-delete">
                ${data.status === 'pending' ? deleteIcon : cancelIcon}
              </button>
            </div>
            `;

          const placeholder = document.createElement('div');
          placeholder.innerHTML = html;
          const node = placeholder.firstElementChild!;

          const btnRun = node.querySelector('button.ts-btn-run')!;
          btnRun.addEventListener('click', () => {
            console.log('run', value);
            api.showLoadingOverlay();
            store.runTask(value).then(() => api.hideOverlay());
          });

          const btnDelete = node.querySelector('button.ts-btn-delete')!;
          btnDelete.addEventListener('click', () => {
            console.log('delete', value);
            api.showLoadingOverlay();
            store.deleteTask(value).then(() => api.hideOverlay());
          });

          return node;
        },
      },
    ],
    getRowId: ({ data }) => data.id,

    rowData: [],
    rowSelection: 'single', // allow rows to be selected
    animateRows: true, // have rows animate to new positions when sorted
    pagination: true,
    paginationPageSize: 10,
    suppressCopyRowsToClipboard: true,
    suppressRowTransform: true,
    suppressRowClickSelection: true,
    enableBrowserTooltips: true,
    onGridReady: ({ api }) => {
      // init quick search input
      const searchInput: HTMLInputElement = searchContainer.querySelector(
        'input#agent_scheduler_search_input',
      )!;
      rxjs
        .fromEvent(searchInput, 'keyup')
        .pipe(rxjs.debounce(() => rxjs.interval(200)))
        .subscribe((e) => {
          api.setQuickFilter((e.target as HTMLInputElement).value);
        });

      store.subscribe({
        next: ([_, newState]) => {
          api.setRowData(newState.pending_tasks);

          if (newState.current_task_id) {
            const node = api.getRowNode(newState.current_task_id);
            if (node) {
              api.refreshCells({ rowNodes: [node], force: true });
            }
          }

          api.sizeColumnsToFit();
        },
      });

      // refresh the state
      store.refresh();
    },
    onRowDragEnd: ({ api, node, overNode }) => {
      const id = node.data?.id;
      const overId = overNode?.data?.id;
      if (id && overId && id !== overId) {
        api.showLoadingOverlay();
        store.moveTask(id, overId).then(() => api.hideOverlay());
      }
    },
  };

  const eGridDiv = gradioApp().querySelector<HTMLDivElement>(
    '#agent_scheduler_pending_tasks_grid',
  )!;
  if (document.querySelector('.dark')) {
    eGridDiv.className = 'ag-theme-alpine-dark';
  }
  eGridDiv.style.height = window.innerHeight - 240 + 'px';
  new Grid(eGridDiv, pendingTasksGridOptions);

  store.refresh();
}

onUiLoaded(initTaskScheduler);
